# Specifikace: MCP server pro víc gmailových schránek


MCP server, který dá asistentovi (Claude Code, Claude Desktop) přístup k **víc gmailovým schránkám naráz** a umožní hledat napříč nimi.

Vestavěný Gmail konektor v Claude umí jednu schránku. Kdo má pracovní, firemní a osobní adresu, nemá jak odpovědět na otázku „řešil jsem to někde?" a věci se mu ztrácejí mezi schránkami.

**Hledání napříč schránkami je funkce, kvůli které server vzniká.** Všechno ostatní jedna schránka umí už dnes.

## Rozsah

**Jen Gmail a Google Workspace, přes IMAP a SMTP.**

Gmail nabízí přes IMAP tři rozšíření, na kterých celý server stojí:

| Rozšíření | K čemu |
|---|---|
| `X-GM-THRID` | číslo vlákna &mdash; jedno `FETCH`, žádné skládání z hlaviček |
| `X-GM-RAW` | plná Gmail syntaxe hledání (`after:`, `from:`, `has:attachment`, `label:`) |
| `X-GM-LABELS` | štítky, čtení i zápis |

Standardní `THREAD` (RFC 5256) Gmail nenabízí. **U jiných poskytovatelů žádné z těch tří rozšíření není** &mdash; vlákna by se musela skládat z `In-Reply-To` a `References` podle RFC 5256 a hledání překládat do IMAP `SEARCH`. To je násobek práce a je to mimo rozsah.

**Cizí poskytovatel se musí odmítnout při načtení konfigurace**, s hláškou, která řekne proč. Tiché přijetí je horší než chybějící funkce &mdash; průchod by pak vypadal, že proběhl, a vrátil rozsypaná data.

**Držet to za rozhraním.** `X-GM-THRID`, `X-GM-RAW` a `X-GM-LABELS` mají být schované za třemi vnitřními rozhraními (zdroj vláken, překlad dotazu, práce se štítky), ne rozeseté napříč kódem. Kdyby se jednou přidával další poskytovatel, dopíše se druhá implementace a zbytek se nemění.

## Autentizace

**Heslo aplikace** (šestnáctimístné, vyžaduje zapnuté dvoufázové ověření). Onboarding jsou tři kliknutí, což je pro použitelnost rozhodující.

`XOAUTH2` Gmail u IMAPu podporuje, ale nepřináší nic navíc: **řízené scopes s IMAPem neexistují.** Gmail IMAP vyžaduje scope `https://mail.google.com/`, tedy plný přístup ke schránce. Omezení přístupu se proto řeší v serveru, ne na straně Googlu.

**Heslo otevírá schránku celou a nedá se zúžit, takže jediná ochrana je způsob uložení.**

Hesla jsou v konfiguračním souboru, buď přímo, nebo jako jméno proměnné prostředí. **Šifrované úložiště se schválně nedělá** &mdash; klíč by musel ležet vedle, takže by to přidalo vrstvu, ne bezpečnost. Ochranou jsou práva k souboru a to, že soubor nikdy nesmí do repa; server při startu kontroluje, jestli neleží v gitu neignorovaný, a řekne to.

## Rozhraní nástrojů

### Schránka je parametr, ne vlastní nástroj

Každý nástroj má parametr `account`. Šest schránek krát osm nástrojů by bylo osmačtyřicet položek v seznamu nástrojů a při přidání schránky by se to muselo rozšiřovat.

**Krátká jména schránek, ne adresy.** Mapování na adresy je v konfiguraci u uživatele; kód, který si adresy nese v sobě, nejde předat dál.

**`account: "all"` hledá napříč všemi.**

### Prefix v názvech nástrojů

Server poběží vedle vestavěného Gmail konektoru, který má nástroje `search_threads` a `get_thread`. Bez prefixu by asistent nepoznal, který volá. Prefix je proto povinný.

### Sada nástrojů

Čtení:

```
mg_list_accounts(verify?)
    → schránky: krátké jméno, adresa, role, jestli smí odesílat,
      štítek „zpracováno" a klasifikační štítky i s významem

mg_next_pass(account, since, max_threads?, page_token?)
    → PRŮCHOD novou poštou; nebere dotaz, viz „Průchod a kotva"
    → account: "all" projde všechny schránky

mg_reload_config()
    → znovu načte config.json a podpisy za běhu, bez nové konverzace (1.2);
      soubor, který se nenačte, nezmění nic; heslo nevrací

mg_label_message(account, message_ids, label, since?)
    → se since vrátí i stav okna po označení (window_clear, searched_at), 1.3

mg_search_threads(account, query, max_results?, page_token?)
    → vlákna odpovídající dotazu; query je Gmail syntaxe, předá se přes X-GM-RAW
    → na hledání konkrétní věci, ne na průchod
    → u vlákna jen souhrn nejnovější odpovídající zprávy, ne celá,
      viz „Hledání vrací souhrn, ne zprávu"

mg_get_thread(account, thread_id)
    → VŠECHNY zprávy vlákna se štítky u každé; těla ne

mg_get_message(account, message_id, body_offset?, max_body_length?)

mg_list_labels(account)

mg_get_attachment(account, message_id, attachment_id)
```

Zápis:

```
mg_label_message(account, message_ids[], label)     ← jen štítek „zpracováno"
mg_unlabel_message(account, message_ids[], label)
mg_label_thread(account, thread_id, label)          ← jen klasifikace, NASTAVUJE ji
mg_unlabel_thread(account, thread_id, label)
mg_set_flags(account, message_id, seen?, flagged?, answered?)
mg_save_draft(account, to, cc?, bcc?, subject, body, html_body?, in_reply_to?, references?, attachments?)
mg_list_drafts(account, max_results?)
mg_send_message(account, to, subject, body, ..., from_alias?, attachments?)
mg_trash_message(account, message_id)
```

`attachments` jsou **cesty k souborům**, a jen z adresářů, které vyjmenuje konfigurace &mdash; viz „Přílohy v odchozí zprávě jsou zamčené zvlášť".

**`format` u čtení nakonec nevznikl.** Dvoustupňové čtení funguje i bez něj: `mg_get_thread` vrací přehled se štítky a těla se tahají přes `mg_get_message`, kde se dají stránkovat.

## Klíčová mechanika: štítky jako stav zpracování

**Tohle je hlavní návrhová myšlenka serveru a odlišuje ho od naivní implementace.**

Asistent, který prochází poštu opakovaně, musí vědět, co už zpracoval. Časové okno (`after:`) na to nestačí, protože se při každém průchodu vrací totéž a přerušený průchod nejde dobrat.

**Řešení: server umí štítkovat, a asistent si tím značí, co viděl.** Dotaz na novou poštu má **přesně dvě podmínky**: nemá štítek „zpracováno" a byl doručen po kotvě.

| | Role |
|---|---|
| **Štítek** | jestli zpráva už průchodem prošla. Není to výrok o vyřízení &mdash; šum ho dostane taky, a stejně tak zpráva, která čeká na odpověď. Co ještě má kdo udělat, nese klasifikace na vlákně. Přesné, nezávislé na čase, **idempotentní** &mdash; přerušený průchod se příště dobere jen zbytku. |
| **Kotva** | datum, do kterého je pošta **prokazatelně celá zpracovaná**. Ne „posledních 14 dní" a ne „od posledního běhu". Bez ní by dotaz na neoznačené sáhl na celý archiv, kde zprávy starší než zavedení systému štítek nemají a nikdy mít nebudou. |

**Kotvu drží klient, ne server.** Server ji dostane v každém volání jako parametr a zůstává vůči průchodu bezstavový &mdash; žádná evidence zpráv, nic k zálohování, není se s čím rozejít. A je to měkký stav: kdyby se ztratil, zeptáš se schránky, která je nejstarší neoznačená zpráva, a máš kotvu zpátky.

### Průchod a kotva

Na průchod je **vlastní nástroj `mg_next_pass`, který nebere dotaz.** Je to jediný způsob, jak vynutit pravidlo o dvou podmínkách: Gmail váží podmínky po zprávě, ne po vláknu, takže jediné `from:` navíc zahodí vlákno, jehož neoznačená zpráva je shodou okolností od někoho jiného &mdash; a odpověď se vrátí jako **čistý prázdný výsledek**. Pravidlo, jehož porušení je tiché, nemá viset na tom, že si ho model přečte a udrží.

**Okno jede podle času doručení.** Používá se IMAP `SINCE` (`INTERNALDATE`), ne Gmailí `after:`. Ty dva se rozcházejí u přeposlané pošty: zpráva přeposlaná dnes, ale psaná minulý měsíc, nese starý `Date`, a hranice podle hlavičky by ji neukázala **nikdy**. `SINCE` porovnává celé dny, takže den kotvy se pokaždé projde znovu; to nic nestojí, protože hotové odfiltruje štítek.

**Kotva se posune, teprve když v okně nezůstane žádná neoznačená zpráva.** Ne po každém běhu. Kdyby se posouvala vždycky, zpráva, které se štítek z jakéhokoli důvodu nezapsal, by se ocitla **pod** kotvou, nebyla by v žádném dalším okně a žádný průchod by ji už nenašel. Server proto vrací `window_clear` a posouvá se na `searched_at` &mdash; čas dotazu, ne čas konce práce, aby pošta doručená během průchodu nespadla pod kotvu.

**Zaseknutá kotva je stejně tichá jako díra.** Když se něco v okně nedaří označit, kotva stojí a okno roste, aniž by kdekoli něco spadlo. Proto se vrací i `oldest_unprocessed_at` &mdash; když se to číslo mezi průchody přestane hýbat, je to vidět.

**Kotva je jedna na schránku.** Společná by se rozešla s realitou hned, jak jedna schránka průchod nestihne: posunula by okno i u ostatních, nebo by kvůli jedné schránce stála všem.

**Šum se musí štítkovat taky.** Neoznačená zpráva se nejen vrací, ona **drží okno otevřené** &mdash; a nejčastěji zůstane neoznačená právě pošta, se kterou se nic dělat nemuselo.

**Koncepty a naplánované zprávy nejsou práce.** Leží ve schránce bez štítku a naplánovaná zpráva vyhoví dotazu až do svého odeslání, takže by okno držely otevřené donekonečna. Štítkovat je nejde spolehlivě &mdash; úprava konceptu zprávu nahradí novou s novým ID, takže štítek to nepřežije. Odečítají se proto **až po vyhledání**, nikdy jako třetí podmínka, která by uměla vlákno schovat, a vracejí se jako počty. Vlákno, kde je jediná neoznačená zpráva koncept, se nevrací vůbec. Naplánované se ukazují u vláken, která prací jsou &mdash; aby se na totéž nenapsala odpověď podruhé.

**Zastaralé zásahy se nevracejí.** Vyhledávací index se po zápisu štítku aktualizuje se zpožděním, takže dotaz chvíli vrací i vlákna, která štítek už mají. Server si štítky přečte `FETCH`em a takové zásahy jen spočítá do `stale_threads`. **Ověřovat zápis dalším hledáním se nesmí** &mdash; odpovědělo by podle stavu z minulé chvíle.

### Hlídač pošty (`--wait`)

Pravidelný průchod přes cron čte celou konverzaci při každém běhu, i když nic nepřišlo: u Věrky kolem 1,5 mil. tokenů z cache za prázdný průchod dlouhé konverzace (27.-29. 9. 2026). Zjistit, jestli přišlo něco nového, model nepotřebuje. **Kontrolu proto dělá server sám** v režimu `--wait --since jmeno=kotva …`: samostatný proces, který asistent spustí na pozadí. Skončí, až přijde pošta, a tím konverzaci probudí; dokud nic nepřijde, nestojí nic. Stejný návrh a stejné kódy jako hlídač `mcp-whatsapp`.

- **Ptá se přesně na totéž co průchod**, stejnou funkcí (`pendingWork` nad `scanWindow` v `src/gmail/pass.ts`). Vlastní dotaz by se s průchodem jednou rozešel a hlídač by hlásil „nic", zatímco průchod by něco našel.
- **Každá zpráva budí jednou.** Co hlídač (i ten před ním) už ohlásil, drží v `wait-known.json` vedle souboru serveru, po schránkách, jen `Message-ID`. Co v okně zůstalo neoznačené, tak nebudí při každé kontrole, a pošta, která přišla, když nikdo nehlídal (v noci mimo pracovní dobu, během průchodu, mezi konverzacemi), vzbudí další hlídač hned při první kontrole. 1.2.0 bralo za známé, co čekalo při první kontrole, a všechno tohle spolklo (revize 1.2.0). Vlastní odeslaná pošta uživatele nebudí.
- **Výstup je jeden řádek s počty po schránkách**, bez odesílatelů a předmětů: skončil by v kontextu i v logu.
- **Chyba není ticho:** odmítnuté přihlášení (zrušené heslo aplikace) dvakrát za sebou a schránka, se kterou server neumí pracovat, končí kódem 5; nová pošta v ostatních schránkách má přednost (kód 0 s poznámkou). Výpadek sítě hlídač nikdy neukončí: notebook bez Wi-Fi model nevzbudí tak jako tak a konec s problémem by hlídání zastavil i po výpadku, který se spraví sám.
- **Přerušené spojení nesmí shodit proces.** ImapFlow po přerušení spojení vysílá událost `error`; bez posluchače ji Node bere jako neošetřenou a ukončí celý proces, server uprostřed konverzace i hlídač (revize 1.2.0). `createClient` ji proto zachytává, rozpracovaný příkaz selže sám.
- **Co hlídat a kdy je v `config.json`** (1.3): u schránky `watch: true`, pro celý soubor `watch_hours` a `watch_interval`. Na jednom místě, ne opsané v poznámce ve vaultu (Karel 30. 9. 2026: na přepis se zapomene). Asistent předá kotvy všech schránek, hlídač si vezme ty s `watch`, a nastavení vidí v `mg_list_accounts`, soubor s hesly číst nemusí. Příkazové `--hours` a `--interval` mají přednost. Interval 5 minut (nejméně minuta), mimo pracovní dobu se nekontroluje a noční pošta vzbudí na jejím začátku.
- **Označení vrátí stav okna** (1.3): `mg_label_message` se `since` po zápisu štítku projde okno znovu (štítky čte FETCH, zpoždění indexu nevadí) a vrátí `window_clear` a `searched_at`. Odpadne tím druhý `mg_next_pass` jen kvůli `window_clear`, tedy jeden celý dotaz modelu na každé probuzení (Věrka 30. 9. 2026).
- **Kódy:** 0 nová pošta, 3 převzal jiný hlídač nebo zmizel rodič, 4 spusť znovu (vypršel čas, zastaveno zvenku; sám končí po 115 minutách, Claude Code zastaví proces na pozadí nejpozději po 2 hodinách), 5 problém pro uživatele, 6 špatné spuštění. 1 a 2 vynechané, ty používá Node a shell při pádu.
- **Jeden hlídač:** každý zapíše do `wait.owner` vedle souboru serveru svůj token; starší, který uvidí cizí, skončí. Při konci ho nemaže: starší hlídač by chybějící soubor vzal jako „pořád můj" a vzbudil se na tutéž poštu podruhé. Kromě `wait-known.json` jediné soubory, které server zapisuje.
- **V každé konverzaci znovu:** proces na pozadí skončí s konverzací. Instalace proto přidá hook `SessionStart` (`startup|resume|clear`), který asistentovi při startu připomene hlídače spustit; hook sám ho spustit neumí, spustí ho asistent s první zprávou nebo s ranním přehledem.

### Štítek na zprávu, ne na vlákno

**Zásadní detail, který jinak celý mechanismus rozbije.**

Gmail u `label_thread` přidá štítek i zprávám, které do vlákna přijdou **později**. Kdyby tedy „zpracováno" bylo na vlákně, nová odpověď by přišla už označená jako zpracovaná a asistent by ji nikdy neviděl.

| Kam | Který štítek |
|---|---|
| na **vlákno** | klasifikace &mdash; platí o celé konverzaci a uživatel ji vidí v poště |
| na **jednotlivou zprávu** | „zpracováno" &mdash; platí jen o té zprávě, kterou asistent skutečně přečetl |

**Server proto musí mít oddělené nástroje pro štítkování vlákna a zprávy.** Nestačí jeden.

**A to rozdělení musí vynucovat kód, ne kázeň.** `mg_label_message` bere jedině štítek „zpracováno", `mg_label_thread` jedině klasifikace, opačné použití se odmítne i s vysvětlením. Server ví z konfigurace, který štítek je který, takže to poznat umí &mdash; a nebezpečnější polovina toho dvojího je stav na vlákně, protože to je právě ta tichá ztráta výš.

**Vlákno nese jednu klasifikaci a ty se vylučují**, takže `mg_label_thread` klasifikaci **nastavuje**: zadaná jde na vlákno a všechny ostatní z nastavené sady v témž volání spadnou. Dvě volání by nechala okamžik, kdy je vlákno ve dvou kategoriích nebo v žádné &mdash; a vlákno bez kategorie vypadá jako nevyřízené. Nová jde nahoru **první**, ať přerušení nechá vlákno klasifikované dvakrát, ne vůbec.

**Sada štítků je uzavřená a je celá v konfiguraci.** Na nic mimo ni nástroje nesáhnou, ani nezaloží, ani neodeberou: nedeklarovaný štítek by po sobě nechal nepořádek v cizí poště a odebrání cizího štítku by potichu odneslo něco, co tam uživatel chtěl mít. U každého klasifikačního štítku je v konfiguraci i **popis, kdy tu kategorii použít** &mdash; podle něj se model rozhoduje, takže názvy můžou být v jakémkoli jazyce a kód o nich neví nic.

**Štítkování zpráv bere seznam a vrací výsledek u každé zvlášť.** Jedno volání místo čtyřiceti, protože každé volání otevírá vlastní spojení a přihlášení stojí zhruba tolik co ta práce sama. A hlavně: podle těch výsledků se rozhoduje o kotvě, takže jedna nepovedená zpráva se nesmí hlásit jako selhání celku ani utopit v úspěchu. Označit znovu už označenou zprávu není chyba.

### Průchod má tři stupně, ne dva

1. **`mg_next_pass`** &mdash; vrátí jen vlákna se skutečnou prací a v nich **jen ty neoznačené zprávy**, s odesílatelem, adresáty a kopiemi zvlášť a s příznakem, jestli je zpráva v inboxu, nebo archivovaná. K tomu `message_count` celého vlákna a jeho současnou klasifikaci.
2. **`mg_get_thread`** u vláken, kde je `message_count` vyšší než počet vrácených zpráv &mdash; vidíš část konverzace a zbytek může změnit význam toho, co čteš. **A stejně tak, když je `message_count` `null`**, tedy když schránka délku vlákna neřekla. Nedosazuje se tam počet zpráv, které server zrovna má &mdash; to by se četlo jako „tohle je celé vlákno" a zbytek konverzace by nikdo nepřečetl.
3. **`mg_get_message`** na těla, která opravdu stojí za přečtení.

Adresáti musí být **`to` a `cc` odděleně**. Být jen v kopii většinou znamená, že věc patří někomu jinému a nezakládá se z ní úkol; sloučení těch dvou tuhle informaci ztratí a je to častější, než to vypadá.

Klasifikace u vlákna tam je proto, aby se dala **vyměnit**, ne jen přidat. Bez ní model nemá jak zjistit, z čeho mění, a přidá druhou.

## Chování, na kterém záleží

### Každá odpověď nese, ze které schránky je

Platí i pro jednotlivé zprávy uvnitř vlákna. Bez toho se u hledání napříč ztratí kontext a vznikne přesně ta chyba, kvůli které server vzniká.

### Vlákno se vrací celé

`mg_get_thread` vrací **všechny zprávy**, ne prvních několik. Zkrácení je povolené jedině u těla jednotlivé zprávy.

Pravidlo se týká `mg_get_thread`. Průchod vrací z vlákna jen jeho neoznačené zprávy a **říká u toho, kolik jich vlákno má celkem**, takže je vidět, že jde o část &mdash; nezkracuje se tam podle pozice, ale podle štítku, a chybějící zbytek je přiznaný číslem.

Vestavěný konektor v hledání ukazuje jen prvních pár zpráv vlákna, takže u dlouhé konverzace je vidět její začátek, ne konec. **Je to systematický zdroj přehlédnutých odpovědí** &mdash; vlákno, jehož poslední zobrazená zpráva je měsíc stará, může mít odpověď z dneška.

### Tělo se stránkuje

U dlouhých vláken nese každá odpověď citovanou historii, takže text narůstá do stovek kilobajtů. Server musí umět vrátit **část těla** (`body_offset` + `max_body_length`) a označit, že text pokračuje.

**Citovaná historie se nesmí brát jako zdroj kontextu.** Bývá v odpovědi, ale není zaručená &mdash; mobilní klienty ji odstřihávají, přílohy se necitují, a hlavně z ní nejde poznat, co chybí. Strukturu vlákna dává jedině vlákno.

### Hledání vrací souhrn, ne zprávu

*Doplněno 16. 9. 2026 po provozu proti reálné schránce.*

`mg_search_threads` na čtyřicet vláken vrátil odpověď, která se nevešla do kontextu a musela se číst ze souboru: u každého vlákna nesl **celý** objekt nejnovější zprávy, tedy sedmnáct polí a zhruba 1 770 znaků na vlákno. Nástroj, který existuje kvůli hledání napříč schránkami, se takhle nedá použít na to, kvůli čemu vznikl.

**U vlákna se proto vrací jen to, podle čeho se v seznamu výsledků rozhoduje:** schránka, ID vlákna, předmět, `matched_messages` a `unprocessed_matches`, a z nejnovější odpovídající zprávy odesílatel, čas doručení, stav, `in_inbox` a `Message-ID`.

**Nic se tím neztrácí, protože hledání je první ze dvou stupňů.** Co v seznamu není, dá `mg_get_thread` a `mg_get_message`, a to celé. Pravidlo „vlákno se vrací celé" tím není dotčené &mdash; týká se `mg_get_thread` a zkracuje se tu seznam výsledků, ne vlákno. **Průchodu se to netýká** taky: `mg_next_pass` vrací jen neoznačené zprávy bez těla a úsporný je už dnes.

`Message-ID` v tom souhrnu zůstává, jakkoli je úzký, protože je to **jediná cesta ke čtení těla bez otevření vlákna**. `uid` naopak vypadlo: popis nástroje sám říká ukládat `Message-ID` a nikdy `uid`, takže ho vracet znamená nabízet něco, co se vzápětí zakazuje.

**Přepínač úrovně podrobnosti se schválně nepřidává**, i když ho vestavěný konektor má. Šel by proti témuž rozhodnutí, kvůli kterému nevznikl `format` u čtení: dvoustupňové čtení funguje bez něj. Snížit výchozí `max_results` je možné jako doplněk, ne jako náhrada &mdash; samo o sobě by to vrátilo méně výsledků, ne levnější.

### Odkazuje se `Message-ID`, ne UID

**IMAP UID platí jen v rámci jedné složky.** Když se zpráva přesune nebo archivuje, UID se změní &mdash; a archivace je běžný způsob, jak si lidé poštu uklízejí.

Odkaz na zprávu, který si asistent uloží mimo server, tedy **musí být `Message-ID` z hlavičky**. Je stabilní napříč složkami i schránkami a zpráva se podle něj dohledá přes `SEARCH HEADER Message-ID`. UID smí být jen dočasný pracovní identifikátor v rámci jedné operace.

**Server proto vrací obojí** a v dokumentaci říká, které z nich je stabilní.

### INBOX není pošta

U schránky s filtry leží většina provozu mimo `INBOX` &mdash; pošta se rozděluje do složek podle lidí a témat. Kdo se dívá jen do `INBOX`, nevidí, co se ve schránce děje.

**Průchod musí brát celou schránku** (`[Gmail]/Všechny zprávy`) a rozlišovat archiv podle **přítomnosti štítku `INBOX`**, ne podle složky.

### Filtruje se podle času doručení

IMAP rozlišuje `INTERNALDATE` (doručení) a hlavičku `Date`. **Okno se počítá podle doručení.** Filtr podle `Date` nechá přeposlané a naplánované zprávy okno obejít.

Prakticky to znamená **nepoužívat Gmailí `after:`, ale IMAP `SINCE`**, které je na `INTERNALDATE` definované. Knihovna obojí rozlišuje (`since` versus `sentSince`), takže to není odhad. Kdyby okno jelo podle hlavičky, propadne přeposlaná pošta &mdash; a té chodí z datových schránek a od účetních dost na to, aby to byla tichá díra přesně toho druhu, kvůli kterému tenhle server vzniká.

Vracet se má obojí, protože se rozcházejí.

### Draft jako odpověď musí ve vlákně zůstat

Draft vytvořený jako odpověď se **nesmí od vlákna odtrhnout**, ani když se mění jen jeho tělo. Poznat se to dá tak, že se ID vlákna rovná ID zprávy - takový draft ve vlákně není a odejde jako samostatný mail.

**Server má úpravu odpovědi buď zvládnout, nebo ji odmítnout.** Ne ji provést a vlákno rozbít. Když se draft musí přepsat smazáním a vytvořením nového, musí se dokončit obojí - jinak v Konceptech zůstane duplikát.

### Naplánované odeslání se musí poznat

Gmail drží naplánovanou zprávu s hlavičkou `Date` nastavenou na **čas plánovaného odeslání**, takže v seznamu vypadá jako zpráva z budoucnosti a nejde poznat, že ještě neodešla.

Server má u zprávy vracet stav: `received`, `sent`, `draft`, `scheduled`.

**Pozná se podle `INTERNALDATE` v budoucnosti, ne podle hlavičky ani podle štítků.** Ověřeno na reálné naplánované zprávě 16. 9. 2026: **Gmail jí nedá žádný štítek a z příznaků jen `\Seen`**, takže test na `\Draft` nebo `\Sent` ji minul, zpráva se vyhodnotila jako doručená a **držela kotvu, dokud neodešla**.

**Hlavička `Date` na to nestačí a je to důležité rozlišení.** Tu píše odesílatel a rozhozené hodiny jsou běžné, takže by se cizí zpráva mohla vyhodnotit jako naplánovaná. **`INTERNALDATE` naproti tomu nastavuje Gmail, když zprávu ukládá**, a doručení v budoucnosti jinak nenastává.

**Podmínka musí navíc žádat, že odesílatelem je sama schránka.** Na timer může čekat jedině vlastní pošta, a **chybné označení cizí zprávy za naplánovanou je tichá ztráta** - nebyla by to práce, nedržela by kotvu a už by se nikdy neukázala.

### Odesílání

**Nový mail jde přes SMTP.** Threading se řeší hlavičkami `In-Reply-To` a `References`; server má přijímat ID s hranatými závorkami i bez nich a doplnit je.

**`From` může být ověřený alias schránky.** Odeslat jako už ověřený alias přes SMTP jde &mdash; je to jen hlavička. Zakládat a ověřovat nový alias přes IMAP ani SMTP nelze, to je jednorázová věc v nastavení Gmailu.

**Kopii do Odeslané pošty si Gmail ukládá sám.** *Opraveno 8. 9. 2026 &mdash; původně tu stálo, že ji neukládá. To platí o SMTP obecně, ne o Gmailu.* Všechno, co projde přes `smtp.gmail.com`, se do Odeslané uloží automaticky a vypnout to nejde. Vlastní `APPEND` navíc by zprávu nahrál podruhé a Gmail na souběžný zápis může vrátit chybu &mdash; ta by se pak hlásila jako chybějící kopie, která ve skutečnosti je.

**Kopie se proto ověřuje, nezapisuje:** po odeslání se v Odeslané hledá `Message-ID`, a teprve když tam není, server ji doplní. **Server musí hlásit oba výsledky zvlášť** &mdash; odeslání a přítomnost kopie jsou dvě různé otázky. Když kopie chybí, mail přesto odešel a **nesmí se posílat znovu**; jen o něm nebude v Odeslané stopa a průchod poštou pak hlásí nesmysly.

**Odeslat existující draft SMTP neumí.** Protokol takovou operaci nezná; draft by se musel přečíst, poslat jako nová zpráva a původní smazat. Pokud to server nabídne, musí ten úklid dokončit &mdash; jinak v Konceptech zůstane neodeslaný duplikát.

### Odesílání je zamčené v konfiguraci

Každá schránka má v konfiguraci **`can_send`**, výchozím stavem `false`, a volitelně seznam povolených adresátů `allowed_recipients`.

**Prázdný seznam znamená nikam, ne kamkoli.** Opačný výchozí stav vypadá jako uzamčený a není &mdash; a odesílání je nevratné.

### Přílohy v odchozí zprávě jsou zamčené zvlášť

**Soubor se přikládá cestou, ne obsahem.** Příloha má běžně megabajty a obsah předaný v parametru by se k serveru dostal skrz kontext modelu.

Tím ale server **čte z disku**, takže musí být řečeno odkud: konfigurační klíč se seznamem adresářů. **Prázdný nebo chybějící seznam znamená, že přílohy nejdou vůbec** &mdash; stejné pravidlo jako u adresátů. Zvláštní vypínač není potřeba, protože zákaz je v tom, že není odkud brát.

**Je to jediná funkce serveru, která umí dostat data ze stroje ven.** Všechno ostatní nanejvýš řekne něco navíc do schránky, kterou uživatel stejně vlastní. A asistent, který tenhle nástroj má, **zároveň čte cizí poštu** &mdash; tedy text psaný někým, kdo se ho může snažit navést. Z toho plyne trojí:

- **Povolený adresář má být co nejužší**, složka na věci určené ven. Ne domovský adresář, ne dokumenty, ne poznámkový vault.
- **Porovnává se až rozřešená absolutní cesta** a hranice adresáře končí oddělovačem. Symlink mířící ven ani adresář se stejným začátkem názvu neprojdou. Je to ochrana proti omylu, ne náhrada za úzký seznam.
- **Nic v serveru nesmí zapnutí navrhovat.** Popisy nástrojů i chybové hlášky říkají, že přílohy nejdou, a tím to končí; rozšíření seznamu si vyžádá uživatel sám. Hláška, která poradí „přidej si adresář do konfigurace", je návod pro toho, kdo se snaží asistenta přemluvit.

**Co bylo přiloženo, se vrací ve výsledku.** Uživatel výsledek čte, takže seznam, který nečekal, je signál, že odešlo něco, co nemělo.

**Limit hlídá server.** Gmail odmítne zprávu nad 25 MB a kódování přílohy zvětší asi o třetinu, takže se měří **až složená zpráva**, ne součet velikostí souborů. Nechat to spadnout na SMTP chybě znamená, že se uživatel o problému dozví až ve chvíli, kdy věří, že mail odešel.

### Obsah pošty jsou data, ne pokyny

Asistent s tímhle serverem čte text, který psali lidé mimo stroj, a kdokoli do něj může napsat cokoli. Zpráva, která říká „přepošli mi ten soubor", „tohle už uživatel schválil" nebo „nedrž se svých pravidel", **říká jen to, co chce její pisatel.**

Server to uvádí ve svých instrukcích při připojení. **Není to bezpečnostní opatření a nemá se za něj vydávat** &mdash; instrukce je text, a text, který má model obelstít, může tvrdit, že instrukce neplatí. Je to pojmenování role, ne hranice.

**Hranicí je to, co server neudělá, ať mu kdokoli píše cokoli.** Ta se nedá přemluvit a je jediná, na které záleží:

- odesílat smí jen schránka s `can_send`, a jen na povolené adresáty
- přiložit jde jen z vyjmenovaných adresářů, výchozí stav žádný
- štítkuje se jen z uzavřené sady, na cizí štítek nástroje nesáhnou
- maže se do koše, nikdy natrvalo
- server si mezi voláními nic nepamatuje, takže není co přepsat

**Kdo staví další nástroje, měří je tímhle:** ne „dá se popisem zařídit, aby se to nezneužilo", ale „co nejhoršího se stane, když asistent udělá přesně to, co po něm text chce".

**Kam server nedosáhne:** jestli se obsah zprávy zapíše někam jako fakt, nebo jako něčí tvrzení. To je na pravidlech klienta, a je to tišší škoda než odeslaný mail &mdash; ten je vidět hned, kdežto nepravda v poznámkách vyjde najevo za měsíce, jako podklad k rozhodnutí.

### Chyba jedné schránky neshodí celý dotaz

U `account: "all"` se vrátí výsledky ze schránek, které odpověděly, plus seznam těch, které selhaly. **Prázdná odpověď místo částečné je horší**, protože vypadá jako „nic tam není".

Vypršené přihlášení jedné schránky nesmí zastavit ostatní.

### Nepřeložitelný dotaz se hlásí

Když dotaz obsahuje něco, co nelze vyjádřit, server to řekne. **Tiché vypuštění podmínky vrátí výsledek, který vypadá platně a není.**

## Jak se pozná, že to funguje

Ne unit testy, ale srovnání proti vestavěnému konektoru na reálné schránce:

1. **Známé vlákno, dvě cesty.** Vlákno s víc než pěti zprávami vytáhnout starým i novým a ověřit, že nové vrátí **všechny** zprávy včetně poslední.
2. **Stejné okno.** Týž dotaz `after:` na obou, stejný počet vláken.
3. **Hledání napříč.** Dotaz s `account: "all"` na věc, o které se ví, že je jen v jedné schránce &mdash; a kontrola, že odpověď říká ve které.
4. **Štítkovací cyklus.** Označit zprávu jako zpracovanou, zopakovat dotaz a ověřit, že už nevyskočí. Pak do vlákna doručit novou zprávu a ověřit, že vyskočí znovu.
5. **Sdílená schránka s filtry.** Průchod nad `[Gmail]/Všechny zprávy` musí vrátit i to, co v `INBOX` není.
6. **Dlouhé vlákno.** Vlákno, u kterého vestavěný konektor odmítá vrátit text, musí projít po částech.
7. **Vypršené přihlášení.** Zneplatnit údaje jedné schránky a ověřit, že server řekne které a ostatní jedou dál.
8. **Cizí poskytovatel.** Do konfigurace dát negmailovou schránku a ověřit, že se odmítne s vysvětlením.
9. **Stabilita odkazu.** Uložit si `Message-ID`, zprávu archivovat a ověřit, že se podle něj pořád dohledá.

Ke každému z nich patří, že se porovnává s vestavěným konektorem. Následující čtyři se srovnávat nedají s ničím a **musí se ověřit samy o sobě**, protože stojí na předpokladech, které při návrhu nešlo změřit:

10. **Okno jede podle doručení.** Přeposlat si zprávu starou víc než okno a ověřit, že se v průchodu objeví. Server vrací `received_at` i `date_header`, takže je na nich rovnou vidět, že se rozcházejí. **Kdyby to selhalo, propadá přeposlaná pošta** a je to tichá díra.
11. **Naplánované zprávy jsou přes IMAP vidět.** Naplánovat odeslání a ověřit, že se zpráva objeví v `scheduled_in_window` a u svého vlákna v `pending_outgoing`. Když ji Gmail přes IMAP neukáže, hlídání dvojí odpovědi prostě není a je lepší to vědět.
12. **Diakritika v názvech štítků.** Založit štítek s háčky a čárkami, hned si ho vypsat přes `mg_list_labels` a pověsit ho na vlákno. IMAP jména složek kóduje zvlášť a je to místo, kde se to láme.
13. **Výměna klasifikace.** Pověsit na vlákno jednu kategorii, pak druhou, a ověřit, že první spadla &mdash; v jednom volání, bez okamžiku, kdy vlákno nese obě.

## Struktura repa

Tyhle věci mají vzniknout **jako první commity, ne až potom.** Doplnit je později znamená, že do té doby vzniklý kód a historie je bez nich - a historii commitů se nedá přepsat bez force-push celého repa.

### `LICENSE`

**MIT nebo Apache 2.0.** Bez licence platí „všechna práva vyhrazena" a kód nesmí legálně použít nikdo, včetně lidí, kterým je určený.

### `.gitignore`

Minimálně tohle, a hned:

```
.env
.env.*
config.json*
config.local.*
credentials*
token*
*.sqlite3
*.db
```

### `config.example.json`

Konfigurační příklad **s vymyšlenými adresami**. Nikdy s reálnými - reálné adresy v příkladu se dostanou do historie commitů a odtud se nedají odstranit.

Konfigurace obsahuje per schránku:

| Klíč | K čemu |
|---|---|
| krátké jméno | jak se schránka volá v nástrojích |
| adresa | e-mailová adresa |
| heslo aplikace | buď hodnota, nebo jméno proměnné prostředí &mdash; právě jedno z nich, obojí naráz se odmítne |
| role | jestli je schránka osobní, nebo sdílená a čte ji víc lidí |
| smí odesílat | ano/ne, výchozí ne |
| štítek „zpracováno" | celý název štítku, kterým se značí viděná zpráva, například `v` |
| klasifikační štítky | celé názvy štítků, které smí asistent pověsit na vlákno, u každého **kdy tu kategorii použít**. Na nic jiného nástroje nesáhnou &mdash; ani nepřidají, ani neodeberou. Dají se napsat jednou nahoře pro všechny schránky. |
| povolení adresáti | volitelně; přítomný seznam se vynucuje přesně, prázdný nedovolí nikam |

A jednou pro celý server: adresář, kam se ukládají stažené přílohy, a **adresáře, ze kterých smí odchozí zpráva přiložit soubor** &mdash; ty druhé jsou výchozím stavem prázdné a prázdno znamená, že přílohy nejdou.

**Časová hranice v konfiguraci není.** Kotvu drží klient a předává ji v parametru `since`; klouzavé okno v konfiguraci by si s ní odporovalo. Při úplně prvním průchodu se za kotvu bere **den, kdy se server zapnul** &mdash; starší pošta štítek nemá a nikdy mít nebude, takže by ji každý průchod znovu procházel.

**Neznámý klíč v konfiguraci je chyba, ne přehlédnutí.** Překlep v názvu seznamu adresátů by jinak tiše znamenal „bez omezení".

### `README.md` a `README.en.md`

**Jazyk se řídí tím, kdo text čte.** Hlavní publikum jsou čeští uživatelé, takže `README.md` je česky a `README.en.md` se udržuje vedle něj. Česky je i ukázková konfigurace a chyby konfigurace při startu &mdash; ty čte člověk v logu, když server nenaběhne.

**Anglicky zůstává kód, komentáře, názvy nástrojů, popisy nástrojů a parametrů, instrukce serveru při startu a chyby z nástrojů.** Ty čte jenom model, uživatel je nikdy neuvidí. Kdyby byly česky, musely by pro anglické publikum vzniknout podruhé &mdash; a **text, který řídí chování modelu, se ve dvou verzích rozejde tiše.** U README se rozejití pozná při čtení, u popisu nástroje ne.

## Co do repa nepatří

- **Přihlašovací údaje.** Ani jako příklad, ani v testech.
- **Konkrétní mailové adresy** a jména reálných schránek. Konfigurace patří mimo repo.
- **Obsah pošty** v ukázkách a testovacích datech.
