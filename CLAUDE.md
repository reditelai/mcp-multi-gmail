# MCP server pro víc gmailových schránek

MCP server, který dá asistentovi přístup k víc gmailovým schránkám naráz. Vestavěný Gmail konektor v Claude umí jednu schránku - tenhle server dá asistentovi pracovní, firemní i osobní adresu v jednom připojení. Většina nástrojů pracuje s jednou schránkou; hledání napříč všemi (`account: "all"`) je jedna z možností, ne hlavní smysl.

**Plná specifikace je v `SPEC.md`.** Přečti si ji před první změnou v kódu. Tenhle soubor drží jen to, co se při psaní kódu snadno poruší.

## Rozsah: jen Gmail a Workspace, přes IMAP a SMTP

Server stojí na třech gmailových rozšířeních IMAPu: `X-GM-THRID` (vlákna), `X-GM-RAW` (plná syntaxe hledání), `X-GM-LABELS` (štítky). U jiných poskytovatelů žádné z nich není.

**Cizí poskytovatel se nepřijímá tiše.** V konfiguraci není volba serveru, připojuje se vždycky na `imap.gmail.com`, a když schránka gmailová rozšíření nehlásí, nástroj vrátí `provider_unsupported` s vysvětlením. Tiché přijetí je horší než chybějící funkce, protože průchod pak vypadá, že proběhl.

## Sedm zásad, které se snadno poruší

Každá z nich vznikla z reálné chyby. Když se poruší, **projeví se to tím, že něco tiše zmizí** - ne chybou.

**1. Vlákno se vrací celé.** Nikdy jen prvních N zpráv. Hledání u dlouhého vlákna ukazuje jeho začátek, ne konec, takže vlákno s měsíc starou poslední zobrazenou zprávou může mít odpověď z dneška. Zkrátit se smí jedině tělo jednotlivé zprávy, a to označeně.

**2. Štítek „zpracováno" patří na zprávu, klasifikace na vlákno.** Gmail u `label_thread` přidá štítek i zprávám, které do vlákna přijdou **později** - kdyby „zpracováno" bylo na vlákně, nová odpověď by přišla už označená a nikdo by ji neviděl. Proto musí existovat **oddělené nástroje** pro vlákno a pro zprávu.

**3. Odkazuje se `Message-ID`, ne UID.** IMAP UID platí jen v rámci jedné složky, takže archivace ho změní. Odkaz, který si klient uloží, musí být `Message-ID` z hlavičky. UID smí být jen dočasný pracovní identifikátor v rámci jedné operace. **Vracet se má obojí** a v dokumentaci říct, které je stabilní.

**4. Filtruje se podle času doručení**, ne podle hlavičky `Date`. Rozcházejí se u přeposlaných a naplánovaných zpráv - naplánovaná zpráva má v `Date` čas budoucího odeslání. Vracet se má obojí, filtrovat podle doručení.

**5. Prázdný seznam povolených adresátů znamená nikam, ne kamkoli.** Opačný výchozí stav vypadá jako uzamčený a není. Totéž pro seznam schránek, ze kterých se smí odesílat.

**6. Chyba jedné schránky neshodí celý dotaz.** U dotazu napříč schránkami se vrátí výsledky těch, které odpověděly, plus seznam těch, které selhaly. Prázdná odpověď místo částečné je horší, protože vypadá jako „nic tam není".

**7. Nepřeložitelný dotaz se hlásí, nezamlčuje.** Když v dotazu je něco, co nelze vyjádřit, řekni to. Tiché vypuštění podmínky vrátí výsledek, který vypadá platně a není.

## Co je mimo rozsah

Nepřidávej to, ani když to jde snadno:

- **Jiní poskytovatelé** než Gmail a Workspace.
- **Skládání vláken z hlaviček** (`In-Reply-To`, `References`). U Gmailu je vlákno nativní a skládání je potřeba jen tam, kam server nesahá.
- **Nastavení účtu** - zakládání aliasů, filtry, přesměrování, odpověď v nepřítomnosti. Odeslat jako **už ověřený** alias je naopak v rozsahu, je to jen hlavička `From`.
- **Jakýkoli trvalý stav v serveru.** Ani evidence zpráv, ani kotva průchodu: kotvu drží klient a předává ji v každém volání. Server, který si mezi voláními nic nepamatuje, se nemá s čím rozejít a není co zálohovat.
- **Atomické odeslání existujícího draftu.** SMTP to neumí a obcházet to sekvencí čtení, odeslání, uložení kopie a mazání je riziko - u nevratné operace se to nedělá tiše.

## Co nikdy nesmí do gitu

- **Přihlašovací údaje.** Ani jako příklad, ani v testech, ani zakomentované.
- **Konkrétní mailové adresy** a jména reálných schránek. Konfigurační příklad má vymyšlené hodnoty.
- **Obsah pošty** v ukázkách, testovacích datech ani v popisech chyb.

`.gitignore` má tyhle vzory od prvního commitu, ne až po prvním nedopatření:

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

## Vydání verze

Nová verze se k uživatelům dostane jen releasem. Z něj ji čte info kanál Miládky (`miladka.cz/moduly.json`) a podle `CHANGELOG.md` a `docs/pro-asistenta.md` ji Miládka u uživatele aktualizuje. **Všechny body níž jsou jedno vydání a dělají se spolu, jinak se aktualizace u uživatelů rozbije.**

1. **Dokumentace je hotová před tagem.** Info kanál posílá Miládku na `CHANGELOG.md` a `docs/pro-asistenta.md` **v tagu vydané verze**. Co se dopíše po tagu, Miládka u uživatele neuvidí (29. 9. 2026 se to stalo u 0.2.0).
2. **Changelog:** sekce `## [X.Y.Z] - RRRR-MM-DD` (z „Nevydáno"). **Piš stručně.** **První řádek je souhrn jednou větou** - info kanál ho vezme jako `zmeny` a Miládka ho řekne uživateli. Pak pár bodů, jen to podstatné pro uživatele nebo asistenta. **Starší sekce se nikdy nemažou ani nepřepisují** - podle nich aktualizuje i ten, kdo verze přeskočil.
3. **„Při aktualizaci"** - podsekce v changelogu, **kdykoli má Miládka při aktualizaci něco udělat nebo ověřit**: nový nebo přejmenovaný klíč v `config.json`, změna štítků, nové ověření (třeba `verify`). Přesné kroky; nastavení uživatele mění jen s jeho souhlasem. Když není potřeba nic, napiš to („Nastavení se nemění.").
4. **Návod pro asistenta:** když se změna týká instalace nebo nastavení (nový klíč, nové ověření, nová chyba), uprav příslušný krok v `docs/pro-asistenta.md` i tabulky chyb. Nová instalace a aktualizace musí vést ke stejnému výsledku. README (CS i EN) podle toho taky.
5. **Verze na třech místech:** `package.json` (i `package-lock.json`), sekce v changelogu, tag `vX.Y.Z`. Release workflow nepustí nesoulad.
6. **Web, info kanál** (repo `web-miladka`, push do `main` = produkce, jen na Karlův pokyn): nový modul = záznam v `MODULY` v `src/lib/moduly.ts` s `id` `multigmail`, stejným, jaké návod zapisuje do `system/moduly-instalovane.json`. Vážná chyba ve starší verzi = `minVerze`. Novinka nebo problém, o kterém mají uživatelé vědět = položka v `src/kanal/info.json`. Verzi a souhrn si web bere z releasu sám.
7. **Po vydání ověř** `https://miladka.cz/moduly.json` (drží se 10 minut): verze a souhrn.
8. **Čísla verzí:** od 1.0.0 drží nástroje a klíče konfigurace zpětnou kompatibilitu. Nekompatibilní změna = nová hlavní verze a „Při aktualizaci" s převodem nastavení. Nastavení uživatele (`config.json` ve vaultu) aktualizace sama nemění.
9. **Stejné pravidlo pro každý modul.** Seznam je i v `miladka-vyvoj/CLAUDE.md`; když se tady změní, změň ho tam.
10. **Článek na webu:** když se mění, co dělá uživatel (kroky instalace, co musí nastavit, co uvidí), uprav článek na miladka.cz v repu `web-miladka` (`src/clanky/`, CS i EN; evidence v `miladka-vyvoj/clanky.md`).
11. **Test celé cesty před tagem:** aktualizace z předchozí verze podle changelogu a návodu (na Karlově nebo Věrčině instalaci), a když se změnila instalace, i nová instalace. Návod, který v půlce nefunguje, se k uživatelům nesmí dostat.
12. **Závislost na verzi Miládky:** když modul potřebuje soubory nebo pravidla z novější verze balíčku, napiš to do návodu (oddíl pro danou verzi Miládky) i do „Při aktualizaci", a starší Miládku ať návod zastaví s vysvětlením.
13. **Zápis ve vývoji:** `miladka-vyvoj` - `CHANGELOG-vyvoj.md` (co vyšlo a proč), `_vyvoj/STAV.md`, katalog v `_vyvoj/moduly.md` (stav a verze).

**Hlídá automat:** release workflow neprojde bez souhrnné věty a bez podsekce „Při aktualizaci" v sekci verze a bez souhlasu verzí; po vydání 20 minut čeká, až verzi ukáže `miladka.cz/moduly.json`, a když ne, založí issue. Body 1, 4, 6, 9 a 10 až 13 hlídá jen tenhle seznam.

## Jak se testuje

**Ne unit testy, ale srovnání proti vestavěnému Gmail konektoru na reálné schránce.** Scénáře jsou v `SPEC.md`, sekce „Jak se pozná, že to funguje" &mdash; devět srovnávacích a čtyři, které se nemají s čím srovnávat a stojí na předpokladech, co při návrhu nešly změřit.

Dva z nich rozhodují o tom, jestli je server použitelný vůbec:

- **Vlákno s víc než pěti zprávami** vytáhnout starým i novým a ověřit, že nové vrátí **všechny** zprávy včetně poslední.
- **Štítkovací cyklus:** označit zprávu jako zpracovanou, zopakovat dotaz a ověřit, že už nevyskočí. Pak do vlákna doručit novou zprávu a ověřit, že vyskočí znovu.

Testy proti reálné schránce **nesmí zapisovat testovací data do gitu.**

## Konvence

- **Jazyk se řídí tím, kdo text čte, ne preferencí.** Hlavní publikum jsou čeští uživatelé.
  - **Česky:** `README.md`, hodnoty a popisy v ukázkové konfiguraci, chyby konfigurace při startu (ty čte člověk v logu, když server nenaběhne), tenhle soubor a interní poznámky.
  - **Anglicky:** kód, komentáře, názvy nástrojů, popisy nástrojů a parametrů, instrukce serveru při startu, chyby z nástrojů.
  - **Anglické `README.en.md`** se udržuje vedle českého.
- **Důvod pro tu hranici:** popisy nástrojů a instrukce čte **jenom model**, uživatel je nikdy neuvidí. Kdyby byly česky, musely by pro anglické publikum vzniknout podruhé - a **text, který řídí chování modelu, se ve dvou verzích rozejde tiše.** Zastaralý popis nikde nespadne, jen model udělá něco jiného. U README se rozejití pozná při čtení, u popisu nástroje ne.
- **Nástroje mají prefix**, protože server běží vedle vestavěného konektoru se stejnými jmény (`search_threads`, `get_thread`) a bez prefixu nejde poznat, který se volá.
- **Tři gmailová rozšíření drž za vnitřním rozhraním** - zdroj vláken, překlad dotazu, práce se štítky. Ne rozeseté napříč kódem. Není to příprava na jiné poskytovatele, je to kázeň, díky které se dají vyměnit.
- **Krátká jména schránek v rozhraní**, mapování na adresy jen v konfiguraci. Kód, který si adresy nese v sobě, nejde předat dál.

## Než něco přidáš

Server vzniká kvůli **přístupu k víc samostatným schránkám v jednom připojení.** Hledání napříč nimi je jedna z věcí, které to umožní, ne jediný smysl.

Když váháš, jestli něco přidat, zeptej se, jestli to slouží práci s víc schránkami. Když ne, patří to do „mimo rozsah" - a tam je to schválně.
