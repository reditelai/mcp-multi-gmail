# mcp-multi-gmail

MCP server, který dá asistentovi přístup k několika gmailovým schránkám naráz
a umožní hledat napříč nimi.

*[English version: `README.en.md`](README.en.md)*

Vestavěný gmailový konektor v Claude umí jednu schránku. Kdo má pracovní,
firemní, fakturační a osobní adresu, musí každou z nich hlídat zvlášť - a
většinu z nich jen proto, aby mu nic neuteklo. **Přístup k několika samostatným
schránkám naráz je důvod, proč tenhle server vznikl.**

**Pracovat se schránkami jde samostatně i dohromady.** Většina nástrojů bere
jednu schránku; `mg_search_threads` navíc umí `account: "all"` a projde všechny
naráz. Které z toho dává smysl, záleží na tom, jak se ty schránky k sobě mají:
tam, kde se projekty nepotkávají, je hledání napříč spíš pro výjimku, a tam, kde
se prolínají, je to ta hlavní věc. **Server to nerozhoduje** - rozhoduje to, co
mu zadáte.

**Je to doplněk [Miládky](https://miladka.cz)**, AI asistentky, která běží
v Claude Code nad tvým vaultem, **a běží jen v ní**: vydaný server se spustí
jen ze složky doplňků Miládky. Návod pro asistenta - jak s tebou server
nastavit a jak pak pracovat s poštou - je v
[`docs/pro-asistenta.md`](docs/pro-asistenta.md). Server ho asistentovi nabídne
sám při připojení.

## Instalace

Řekni Miládce: **„Nainstaluj si doplněk pro víc gmailových schránek."**
Postupuje podle [návodu pro asistenta](docs/pro-asistenta.md): stáhne server do
své složky, domluví se s tebou na schránkách a provede tě tím, co musíš udělat
ty. To je u každé schránky heslo aplikace v účtu Google (vyžaduje dvoufázové
ověření) a zapnutý IMAP v Gmailu. Heslo vkládáš do souboru sám, Miládka ho
nevidí.

## Stav

**Server běží v reálném provozu na několika schránkách naráz** - osobní,
sdílené týmové i schránce, kam chodí jen automatické notifikace. Proti
skutečnému Gmailu je vyzkoušené čtení, průchod novou poštou, štítkování,
koncepty i odesílání.

Od verze 1.0.0 drží nástroje a klíče konfigurace zpětnou kompatibilitu;
nekompatibilní změna zvedne první číslo verze. Co se mění, je
v [CHANGELOG.md](CHANGELOG.md).

| Nástroj | K čemu |
| --- | --- |
| `mg_list_accounts` | nastavené schránky a jejich volby |
| `mg_next_pass` | **průchod novou poštou** - vlákna, ve kterých je nezpracovaná zpráva |
| `mg_search_threads` | hledání v jedné schránce nebo **ve všech naráz** |
| `mg_get_thread` | všechny zprávy vlákna |
| `mg_get_message` | jedna zpráva s výřezem těla |
| `mg_get_attachment` | stažení jedné přílohy na disk |
| `mg_list_labels` | štítky schránky |
| `mg_label_message` / `mg_unlabel_message` | štítek na zprávy, jedním voláním |
| `mg_label_thread` / `mg_unlabel_thread` | štítek na celé vlákno |
| `mg_set_flags` | označit zprávu jako přečtenou, s hvězdičkou nebo zodpovězenou |
| `mg_save_draft` | uložit koncept, případně jako odpověď ve vlákně |
| `mg_list_drafts` | koncepty čekající ve schránce |
| `mg_send_message` | odeslat zprávu a ověřit kopii v Odeslané poště |
| `mg_trash_message` | přesunout jednu zprávu do koše |
| `mg_reload_config` | znovu načíst nastavení, hesla a podpisy bez nové konverzace |

**Hlídač pošty:** `--wait --since jmeno=kotva` spustí server jako hlídače na
pozadí. Každých 5 minut se zeptá Gmailu na totéž co průchod a skončí, až přijde
nová pošta, a tím asistenta probudí. Dokud nic nepřijde, nestojí žádné tokeny,
na rozdíl od pravidelného průchodu přes cron. Podrobně v návodu pro asistenta,
oddíl „Hlídač pošty".

Prefix `mg_` v názvech je schválně: server běží vedle vestavěného gmailového
konektoru, který má nástroje stejných jmen.

## Rozsah

**Jen Gmail a Google Workspace, přes IMAP.** Server stojí na třech gmailových
rozšířeních IMAPu:

| Rozšíření | K čemu |
| --- | --- |
| `X-GM-THRID` | ID vláken - jediný `FETCH`, žádné skládání z hlaviček |
| `X-GM-RAW` | plná syntaxe gmailového hledání (`after:`, `from:`, `label:`, …) |
| `X-GM-LABELS` | štítky, čtení i zápis |

Žádný jiný poskytovatel ani jedno z nich nenabízí a standardní `THREAD`
(RFC 5256) Gmail neumí, takže v konfiguraci schválně není volba serveru:
připojuje se vždycky na `imap.gmail.com`.

## Co je potřeba

- [Miládka](https://miladka.cz)
- Node.js 20 nebo novější (tolik vyžadují použité knihovny). Bez práv správce
  jako ZIP z <https://nodejs.org/dist/> s ověřením SHA256, viz návod pro
  asistenta, krok 2.
- **Heslo aplikace** pro každou schránku (16 znaků; vyžaduje na účtu zapnuté
  dvoufázové ověření)
- Zapnutý IMAP v nastavení každé schránky

## Nastavení

Nastavení je ve `system/multigmail.json` ve složce Miládky a zálohuje se s ní,
hesla zvlášť v `.miladka/secrets/multigmail/hesla.json`, který se nezálohuje.
Obojí zakládá Miládka podle návodu pro asistenta. Ukázky jsou dvě:

- [`config.example.json`](config.example.json) - **minimum pro jednu
  schránku**.
- [`config.example.advanced.json`](config.example.advanced.json) - tři
  schránky (vlastní, sdílená týmová a schránka pro automaty), klasifikační
  štítky, povolení adresáti, podpisy a alias.

U každé schránky:

| Klíč | Význam |
| --- | --- |
| `name` | krátké jméno, kterým se schránka volá ve všech nástrojích; musí být jedinečné |
| `address` | e-mailová adresa schránky |
| `password` | heslo aplikace přímo v nastavení |
| `password_env` | jméno proměnné prostředí, ve které heslo je |
| `shared` | `true` u sdílené schránky, kterou čte víc lidí |
| `work_scope` | kolik ze schránky je v průchodu práce: `everything`, nebo `inbox` u týmové schránky; výchozí `everything`; viz [Režimy průchodu](#režimy-průchodu) |
| `assignment_labels` | štítky, kterými se v téhle schránce značí, kdo vlákno řeší; viz [Režimy průchodu](#režimy-průchodu) |
| `my_label` | ten z nich, který znamená uživatele |
| `unread_only` | jestli průchod přeskakuje zprávy, které už někdo otevřel; výchozí `false`, viz [Režimy průchodu](#režimy-průchodu) |
| `can_send` | jestli z téhle schránky smí server odesílat; výchozí je `false` |
| `watch` | jestli ji hlídač pošty (`--wait`) hlídá průběžně; výchozí `false` |
| `allowed_recipients` | adresy nebo `@domény`, kam tahle schránka smí psát; viz níž |
| `processed_label` | celý název štítku, který značí viděnou zprávu, třeba `Asistent`; výchozí je `processed`. **`null` znamená, že se schránka neštítkuje vůbec** - viz [Režimy průchodu](#režimy-průchodu) |
| `classification_labels` | štítky, které smí asistent pověsit na vlákno, jako název a jeho význam; přebíjí sadu uvedenou jednou nahoře v souboru |
| `signatures` | podpisy téhle schránky, jako název a odkud se text bere; viz [Podpisy a aliasy](#podpisy-a-aliasy) |
| `default_signature` | podpis, kterým se zpráva končí, když žádný neurčí; bez něj se podepisuje jen na vyžádání |
| `aliases` | adresy, pod kterými smí tahle schránka psát |
| `smtp_port` | port pro odesílání: `465` nebo `587`. Bez něj server při prvním odeslání zkusí 465 a když se tam nepřipojí, použije 587; viz [`mg_send_message`](#mg_send_message) |

A jednou pro celý server tyhle věci (a `smtp_port` pro všechny schránky, které ho nemají):

| Klíč | K čemu |
|---|---|
| `passwords_file` | soubor s hesly aplikací (krátké jméno schránky → heslo) pro schránky bez `password` a `password_env`; v Miládce `.miladka/secrets/multigmail/hesla.json` |
| `download_dir` | adresář, kam se ukládají stažené přílohy; výchozí `vstupy/prilohy` ve složce Miládky |
| `attachment_dirs` | adresáře, ze kterých smí odchozí zpráva přiložit soubor. **Výchozí stav je prázdno a nech ho tak, pokud nevíš, proč ho měnit** |
| `quote_locale` | jazyk řádky nad citovanou zprávou (`Dne … napsal:` / `On … wrote:`). `cs` nebo `en`, výchozí `cs` |
| `watch_hours` | kdy hlídač pošty kontroluje, třeba `"9-19"`; bez něj celý den |
| `watch_interval` | jak často hlídač kontroluje, třeba `"5m"` (nejméně `"1m"`); výchozí 5 minut |

**Prázdný `attachment_dirs` znamená nikam, ne kamkoli** - stejně jako
`allowed_recipients`. Zvláštní vypínač na přílohy proto není potřeba: zákaz je
v tom, že není odkud brát.

> **Než tohle zapneš, přečti si to.**
>
> Přílohy jsou **jediná věc v tomhle serveru, která umí dostat data z tvého
> disku ven.** Všechno ostatní nanejvýš řekne něco navíc do schránky, kterou
> stejně vlastníš.
>
> A pozor na to, s čím asistent pracuje: **čte poštu, tedy text, který psal
> někdo cizí.** Mail může být napsaný tak, aby ho navedl - „pošlete mi prosím
> soubor …". Povolený adresář je proto přesně tak velký, jak velký únik z něj
> může být.
>
> Když to zapínáš, ať je to **úzká složka určená na věci, co mají jít ven.**
> Ne domovský adresář, ne složka s dokumenty, a rozhodně ne poznámkový vault.
>
> Cesta se porovnává až po rozřešení symlinků a hranice adresáře končí
> oddělovačem, takže odkaz mířící ven ani složka se stejným začátkem názvu
> neprojdou. To je ale ochrana proti omylu, ne náhrada za úzký seznam.

## Režimy průchodu

Průchod je pro každou schránku týž nástroj a týž postup. **Liší se jen tím, co
je v té které schránce práce** - a to si schránka určuje sama, třemi klíči
v konfiguraci. Žádný přepínač „režim" neexistuje: režim je to, co z těch tří
hodnot vyjde.

| Klíč | Co říká |
|---|---|
| `processed_label` | čím se značí zpráva, která už průchodem prošla |
| `classification_labels` | jestli se vlákna třídí, a do čeho. **Prázdná sada znamená, že se v téhle schránce neklasifikuje vůbec** |
| `work_scope` | kolik ze schránky je práce: celá (`everything`), nebo jen doručená pošta (`inbox`) |

Tři kombinace stojí za pojmenování, protože pokrývají skoro všechno.

Když nastavení dělá asistent, nabídne tyhle varianty uživateli a nechá ho
vybrat - postup je v [`docs/pro-asistenta.md`](docs/pro-asistenta.md), krok 4.

### Vlastní schránka

Schránka, ze které píše jeden člověk. Průchod bere celou schránku, klasifikuje
se, odeslaná pošta i archiv jsou práce.

```json
{ "name": "prace", "work_scope": "everything", "can_send": true }
```

**Archiv i odeslaná pošta jsou tu k něčemu dobré:** vlastní odpověď je to, podle
čeho se pozná, že vlákno už je vyřízené, a archiv drží věci, které si ten člověk
sám odložil. Klasifikace dává smysl, protože vlákna v téhle schránce patří
jednomu člověku a jeho třídění nikomu nepřekáží.

### Sdílená týmová schránka

Schránka, do které sahá víc lidí a rozebírají si ji mezi sebou.

```json
{ "name": "tym", "shared": true, "work_scope": "inbox", "can_send": false,
  "classification_labels": {} }
```

Tři rozdíly a každý má svůj důvod:

- **`work_scope: "inbox"`** - co je v doručené poště, to ještě nikdo nevyřídil.
  **Archiv je to, co někdo odložil, a složka Odeslané jsou odpovědi ostatních
  lidí na vlákna ostatních lidí** - obojí je velké a pro toho, kdo schránku čte,
  to není práce. Zprávy mimo rozsah se odečítají po vyhledání, počítají se
  v `outside_scope_in_window` a **nedrží kotvu** - ale u vlákna, které prací je
  z jiného důvodu, se vypíšou, protože „na tohle už někdo odpověděl" je to
  nejcennější, co jde zjistit bez otevření vlákna.

  **Hledá se pořád v celé schránce, ne ve složce INBOX.** Vlákno má zprávy
  roztroušené, takže hledání v jedné složce by udělalo z jeho délky i štítků
  popis útržku.
- **Prázdné `classification_labels`** - klasifikace je tvrzení o tom, co má
  kdo udělat. V cizí schránce je to tvrzení o cizí práci a ostatní ho uvidí.
  Prázdná sada z toho dělá hranici, na kterou server narazí, místo pravidla,
  které se dá přehlédnout. Štítek o zpracování (`processed_label`) se dává dál -
  bez něj by se pošta četla pořád dokola.
- **`can_send: false`** - odepsat za tým z jeho adresy je něco jiného než
  odepsat za sebe.

**Jak se v takové schránce pozná, co je moje.** Tým obvykle značí vlákna podle
toho, kdo je řeší. Když se ty štítky vyjmenují, průchod u každého vlákna rovnou
řekne, čí je:

```json
"assignment_labels": ["Anna", "Beda", "Cyril", "Dana"],
"my_label": "Anna"
```

| `assigned` | Kdy | Co s tím |
|---|---|---|
| `mine` | vlákno má štítek z `my_label` | je to moje práce, přečíst |
| `other` | má některý z ostatních | označit a nechat být, **neotevírat** |
| `none` | nemá žádný ze seznamu | nikdo si ho nevzal |
| `null` | schránka štítky nevyjmenovala | tahle otázka se tu neklade |

**Vlákno, které patří někomu jinému, se tak dá označit a nechat být, aniž se
otevře a přečte** - a to je na sdílené schránce ta drahá část.

Vyjmenování je schválně: schránka nese štítky několika druhů naráz a **vlákno se
štítkem `Archiv` není cizí práce, ale nezabraná věc, kterou někdo odložil.**
Kdyby se vážily všechny uživatelské štítky, znamenalo by „má štítek, který
neznám" totéž co „není moje" - a vlákna ztracená tímhle způsobem se ztrácejí
potichu. Štítek mimo seznam proto nechává vlákno `none`.

Bez těch dvou klíčů zůstávají jen `user_labels`, tedy holý výčet štítků, a co
znamenají, musí rozhodnout ten, kdo server používá.

### Schránka pro automaty

Adresa, kam chodí notifikace ze systémů: fakturační, monitorovací, portálové.

```json
{ "name": "automaty", "work_scope": "inbox", "unread_only": true,
  "can_send": false, "classification_labels": {} }
```

Chová se jako sdílená, jen z jiného důvodu: **nikdo tam nepíše, takže třídit
není co.** Drtivou většinu obsahu zpracuje něco jiného - účetní systém, skript,
kolega - a za pozornost stojí jen to, k čemu se nikdo nedostal.

**Schránka, kterou si člověk odbývá čtením, nemusí být štítkovaná vůbec.** Pak se
`processed_label` nastaví na `null` a průchod se ptá jen na časovou hranici:

```json
{ "name": "automaty", "work_scope": "inbox", "unread_only": true,
  "processed_label": null, "can_send": false, "classification_labels": {} }
```

Má to jeden důsledek, se kterým se musí počítat: **kotva se nemá jak pohnout.**
Zpráva zůstane v okně, dokud ji někdo nepřečte, takže `window_clear` bude
`false` a průchod ji bude vracet pořád dokola. **Taková schránka patří do
průchodu jednou denně, ne každou půlhodinu.** Výměnou za to v cizí schránce
nepřibude štítek, který by tam nikomu nic neříkal.

**`unread_only` je na to ten správný nástroj, ale je slabší než `work_scope`.**
Archiv a odeslané jsou stavy, které někdo zvolil; přečteno je stav, který
způsobí i náhledové okno. **Zpráva, kterou si někdo otevře na mobilu, z průchodu
vypadne a nevrátí se** - je mimo rozsah, takže nikdy nedostane štítek. Stojí to
za to jedině tam, kde je druhá možnost číst úplně všechno.

Server sám ten příznak nikdy nenastavuje: každá čtecí cesta otevírá složku
jen pro čtení, takže pohled do schránky nezmění, co o sobě říká.

### Co režim nemění

Ať je schránka jakákoli, průchod má pořád **jen dvě podmínky: nenese štítek
o zpracování a přišlo po zadané hranici.** Nic z toho, co je výš, se do dotazu
nepřidává - všechno se odečítá až po vyhledání. Důvod je v [`mg_next_pass`](#mg_next_pass):
Gmail váží podmínky po zprávě, takže podmínka navíc zahodí celé vlákno a
odpověď se vrátí jako čistá nula.

Stejně tak platí ve všech režimech, že **kotva se posouvá jedině na
`window_clear: true`** a že **každá viděná zpráva dostane štítek o zpracování**,
včetně té, která se jen odbyla pohledem na odesílatele.

## Podpisy a aliasy

Jedna schránka málokdy píše jedním hlasem. Ta samá adresa posílá nabídky,
faktury i osobní odpovědi, a každá z nich končí jinak. **Proto tu podpis patří
k aliasu, ne ke schránce** - pod jakou adresou zpráva odejde a jak se podepíše
je jedno rozhodnutí, a rozdělit ho znamená vybrat správnou adresu a podepsat ji
špatně.

```json
{
  "name": "firma",
  "address": "jan.novak@example.com",
  "can_send": true,
  "signatures": {
    "plny": { "html_file": "podpisy/plny.html", "text_file": "podpisy/plny.txt" },
    "kratky": { "text": "Jan" },
    "obchod": { "text": "Jan Novák\nobchodní oddělení" }
  },
  "default_signature": "plny",
  "aliases": [
    {
      "address": "obchod@example.com",
      "name": "Firma - obchod",
      "purpose": "poptávky, nabídky a ceníky",
      "default_signature": "obchod"
    }
  ]
}
```

**Podpis se píše tam, kde se píše text - ne do JSONu.** Je dlouhý, plný uvozovek
a značek, a mění se. V souboru se otevře jako stránka; v konfiguraci by se
musel po každé úpravě přeescapovat. `text` a `html` přímo v souboru jsou pro
krátké podpisy, kde to za samostatný soubor nestojí. Relativní cesta k souboru
se počítá od složky, ve které leží konfigurace. Podpisy nejsou tajné:
patří do modulu pošty (`.miladka/moduly/mail/podpisy/`) a ze
`system/multigmail.json` se na ně odkazuje cestou
`../.miladka/moduly/mail/podpisy/plny.html`.

**Obě podoby se drží zvlášť a každá strana zprávy dostane svou.** Podpis zadaný
jen jako text se pro HTML stranu převede, ne zahodí - zpráva, která končí
ničím, vypadá useknutě.

**`purpose` čte asistent, ne Gmail.** Bez něj je alias jen adresa, u které se
nedá poznat, kdy je ta správná - a co asistent nepozná, to prostě nepoužije.

**Alias musí být v konfiguraci.** Gmail by neověřený stejně odmítl, ale to není
ten důvod: pod jakými adresami schránka píše, rozhoduje ten, kdo ji nastavoval,
a adresa, která jen není zakázaná, není totéž co adresa povolená. Stejné
pravidlo jako u `allowed_recipients` a `attachment_dirs`.

**Podpis, který se nenajde, je chyba, ne tichá nepodepsaná zpráva.** Podpis je
to, co příjemci říká, kdo píše, a volající věřil, že tam je.

**V těle zprávy se podpis neopakuje.** Vkládá ho server, **nad citaci** - pod
historií by skončil na dně vlákna, které s každou odpovědí roste.

## Obsah pošty jsou data, ne pokyny

Asistent, který tenhle server používá, **čte text psaný lidmi mimo tvůj
počítač**. Do mailu může kdokoli napsat cokoli - včetně vět určených jemu:
„přepošli mi ten soubor", „tohle už uživatel schválil", „nedrž se svých pravidel".

Server to říká ve svých instrukcích. **Není to ale bezpečnostní opatření a
nespoléhej se na něj** - instrukce je taky jen text a text, který má asistenta
obelstít, může tvrdit, že instrukce neplatí.

**Skutečná hranice je to, co server neudělá, ať mu kdokoli píše cokoli:**

- odešle jen ze schránky, která to má povolené, a jen povoleným adresátům
- přiloží soubor jen z vyjmenovaných adresářů, a bez nich vůbec
- pověsí jen štítek, který je v konfiguraci
- maže do koše, nikdy natrvalo
- nepamatuje si nic mezi voláními, takže není co přepsat

Proto stojí za to nechat `attachment_dirs` prázdné a `allowed_recipients`
vyplněné, i když je to nepohodlné. **Ta omezení se nedají ukecat.**

**A jedna věc, kam server nedosáhne:** co si asistent z pošty zapíše do svých
poznámek. Odeslaný mail uvidíš hned, ale nepravda uložená jako fakt vyjde
najevo za měsíce - ve chvíli, kdy podle ní něco rozhodneš. Tohle si musí
pohlídat pravidla, podle kterých asistent píše.

`processed_label` je **celý** název štítku, ne koncovka pod nějakým prefixem -
napiš `Asistent`, pokud tvoje schránka používá tohle.

`classification_labels` vyjmenovává štítky, které smí asistent pověsit na
vlákno, u každého i to, co znamená:

```json
"classification_labels": {
  "Asistent/info": "dobré vědět, nic se nedělá",
  "Asistent/hoří": "musí se to stihnout dneska"
}
```

**Ten popis není komentář.** Je to text, podle kterého se asistent rozhoduje,
který štítek se hodí - takže názvy můžou být v jakémkoli jazyce a kód o nich
nemusí nic vědět. Napsané nahoře v souboru platí pro všechny schránky; schránka,
která si vyjmenuje vlastní, tu sadu **nahradí**, ne rozšíří, protože soubor,
který říká, jaké štítky schránka používá, to má myslet vážně.

**Tyhle dvě volby jsou zároveň celý seznam štítků, na které nástroje sáhnou.**
Štítek, který v nich není, se odmítne v obou směrech: nedeklarovaný se nikdy
nezaloží a štítek, který na vlákno pověsil uživatel sám, se nikdy neodebere. To
první nechává po sobě nepořádek, který pak musíš najít a smazat; to druhé
potichu odnese něco, co jsi tam chtěl mít - a chybějící štítek se neprojeví
vůbec nikde. `mg_list_labels` pořád vypíše všechno, co ve schránce je, jen se to
odsud nedá měnit.

Pozor na to, že zanoření zapsané lomítkem je v Gmailu **jen zobrazení**, ne
dědičnost: `Asistent/hoří` a `Asistent` jsou dva nezávislé štítky a zpráva,
která nese první z nich, nenese druhý. Tomu rozdělení, na kterém server stojí, to vyhovuje -
štítek „viděl jsem to" jde na zprávu, klasifikace na vlákno - ale znamená to, že
se musí pověsit obojí.

Heslo má každá schránka právě jedno: `password`, `password_env`, nebo řádek
v souboru z `passwords_file`. `password` a `password_env` naráz se odmítne, protože by nebylo jasné, které se používá, a zapomenutá
hodnota v tom druhém je heslo, o kterém nikdo neví, že tam je.

`can_send` je u každé schránky výchozím stavem `false`. Konfigurace, která by
odesílání povolila tím, že se nic nenapíše, by vypadala zamčeně, aniž by zamčená
byla.

`allowed_recipients` je nepovinný a když tam je, vynucuje se přesně. **Seznam,
který existuje a je prázdný, nedovolí nikam** - právě kvůli tomu se píše.
Vynechaný klíč znamená bez omezení adresátů, takže zbývá jediná pojistka
`can_send`. Položka je buď celá adresa, nebo doména zapsaná jako
`@example.com`, a pravidlo pro doménu platí jen pro ni: `@partner.example`
dovolí `a@partner.example`, ale ani `a@zly-partner.example`, ani
`a@sub.partner.example`.

### Jak ten soubor udržet mimo repozitář

Soubor s hesly patří do `.miladka/secrets/multigmail/` (celá
`.miladka/secrets/` v `.gitignore` vaultu). Nastavení bez hesel (s
`passwords_file`) smí do zálohy: leží ve `system/multigmail.json`. Pravidlo `config.json*` v
`.gitignore` serveru je jen záchranná síť pro případ, že se soubor nebo jeho
záloha do složky serveru dostane. Zálohy dělej do téže složky jako originál.

Když soubor s hesly leží v repozitáři, **zkontroluj, že je ignorovaný** (`git
check-ignore -v cesta/k/souboru` musí vypsat pravidlo). Při
startu se server podívá, kde soubory s hesly leží: když je uvnitř gitového repozitáře a
není ignorovaný, řekne to na stderr dřív, než začne odpovídat. Je to varování,
ne odmítnutí - ale neignoruj ho, protože tajemství, které se dostane do
historie, se z ní nedá odstranit.

## Spuštění

Miládka server zapisuje do `.mcp.json` v kořeni své složky, s cestami
relativními k ní:

```json
{
  "mcpServers": {
    "multi-gmail": {
      "command": "node",
      "args": [".doplnky/mcp-multi-gmail/mcp-multi-gmail.mjs", "--config", "system/multigmail.json"]
    }
  }
}
```

Mimo složku doplňků Miládky (`.doplnky/mcp-multi-gmail/`, v anglické Miládce
`.addons/`) nebo ve složce bez `.miladka/VERSION` server nenaběhne a odkáže na
miladka.cz.

## Co server řekne asistentovi

Při připojení podá server klientovi krátkou sadu instrukcí, a klient, který je
modelu ukáže, je před něj položí ještě dřív, než se zavolá první nástroj. Nesou
to málo, co platí o celém serveru a nedá se pověsit na jeden nástroj: které
schránky jsou k dispozici a že se dají prohledat i naráz, co znamenají ty dva
druhy štítků, a že nastavená sada štítků je zároveň celá sada.

**Nejsou napsané natvrdo, ale poskládané z konfigurace**, a v tom je ta
užitečná část. Štítky každé schránky se vypíšou i s významem, takže asistent
nikdy nemusí hádat název. A když žádné klasifikační štítky nastavené nejsou,
instrukce to řeknou a požádají asistenta, aby je s uživatelem před prvním
průchodem probral - věta, která se objeví jen dokud je pravdivá. Instrukce se
totiž posílají při každém připojení, takže napevno napsaná verze té žádosti by
se opakovala na začátku každé konverzace navždycky, a tak se z instrukce stane
text, který model přestane vnímat.

## Jak nástroje zapadají do sebe

Jeden průchod poštou vypadá takhle:

1. **`mg_next_pass` pro každou schránku zvlášť** a s její kotvou - datem, do kterého
   je pošta v té schránce prokazatelně celá zpracovaná. Každá schránka má vlastní
   kotvu: `account: "all"` vrací jeden `window_clear` a jeden `searched_at` za všechny
   dohromady, takže jedna schránka s nezpracovanou zprávou by držela okno i ostatním. Dotaz skládá server sám ze štítku a z kotvy;
   **není kam přidat podmínku navíc**, a to je smysl toho, že je to vlastní
   nástroj a ne parametr hledání.
2. **`mg_get_thread` na vlákna, kde `message_count` je vyšší než počet vrácených
   nezpracovaných zpráv.** Vidíš totiž část konverzace a zbytek může změnit
   význam toho, co čteš.
3. **`mg_get_message`** na těla, která opravdu stojí za přečtení.
4. **`mg_label_message`** se štítkem `processed_label` na **každou** zprávu, na
   kterou ses podíval, včetně šumu - **jedním voláním se seznamem**, ne po jedné.
   A **`mg_label_thread`** s klasifikací té konverzace.
5. **Kotvu posuň na `searched_at`, ale jedině když je `window_clear` true.**
   Dokud je false, v okně něco neoznačeného zůstalo a příště se projde znovu.

Proč se kotva posouvá takhle opatrně: kdyby se posunula po každém běhu, zpráva,
které se štítek z jakéhokoli důvodu nezapsal, se ocitne **pod** kotvou - není
pak v žádném dalším okně a **žádný průchod ji už nikdy nenajde.** Neoznačený šum
naopak kotvu drží na místě, takže označit se musí opravdu všechno, na co ses
podíval.

## Nástroje

### `mg_list_accounts`

Vypíše nastavené schránky: krátké jméno, adresu, jestli je schránka sdílená,
jestli je povolené odesílání, štítek značící viděnou zprávu, klasifikační štítky
i s významem každého z nich, podpisy a aliasy.

Je tu i **`work_scope`**, tedy kolik ze schránky průchod bere jako práci - viz
[Režimy průchodu](#režimy-průchodu). **Stojí za to si to přečíst dřív, než
z chybějící pošty vyjde závěr**, že něco nechodí: „nepřišlo" a „je mimo rozsah"
vypadá odsud stejně.

S `verify: true` se navíc do každé schránky přihlásí a ověří heslo aplikace.
U schránek, které smí odesílat, ověří i odesílání (přihlásí se na SMTP a nic
nepošle) a v `smtp` vrátí port, přes který jde. Schránky se kontrolují
souběžně a **schránka, která selže, se ohlásí vedle výsledků, ne místo nich.**
Selhání s `check: "smtp"` znamená, že čtení funguje, ale odeslat by nešlo.

### `mg_next_pass`

Vrátí vlákna, ve kterých je zpráva, co ještě neprošla průchodem. **Tohle je
nástroj na procházení nové pošty**; `mg_search_threads` je na hledání konkrétní
věci.

**Nemá parametr s dotazem, a to je jeho smysl.** Průchod se ptá přesně na dvě
věci - nemá štítek zpracováno, a byl doručen po zadané kotvě - a nic dalšího se
do toho dotazu nedá přidat, protože tudy nevede cesta. Gmail totiž váží podmínky
po zprávě, ne po vláknu: jediné `from:` navíc zahodí vlákno, jehož nezpracovaná
zpráva je shodou okolností od někoho jiného, a odpověď se vrátí jako čistý
prázdný výsledek.

**Okno jede podle času doručení, ne podle hlavičky `Date`.** Je to IMAP `SINCE`,
ne Gmailí `after:` - ty dva se rozcházejí u přeposlané pošty a hranice podle
hlavičky by zprávu přeposlanou dnes, ale psanou minulý měsíc, neukázala už
nikdy. `SINCE` porovnává celé dny, takže den kotvy se pokaždé projde znovu; to
nic nestojí, protože hotové zprávy odfiltruje štítek.

Vrací se **jen vlákna se skutečnou prací.** U každého jeho nezpracované zprávy
s odesílatelem, adresáty a kopiemi odděleně - být jen v kopii většinou znamená,
že věc patří někomu jinému - a jestli je zpráva v inboxu, nebo archivovaná.
`message_count` je velikost celého vlákna: když je vyšší než počet vrácených
zpráv, vidíš část konverzace a zbytek si dotáhni přes `mg_get_thread`. Je
`null`, když schránka délku vlákna neřekla - **schválně se tam nedosazuje počet
zpráv, které zrovna známe**, protože to by se četlo jako „tohle je celé vlákno"
a zbytek konverzace by nikdo nepřečetl.

`classification` u vlákna říká, jakou kategorii teď nese - abys věděl, z čeho
měníš, když ji chceš přepsat.

`pending_outgoing` vypíše u vlákna tvoje **koncepty a naplánované zprávy**, ať
nenapíšeš druhou odpověď na něco, co už čeká na časovači.

**Koncepty a naplánované zprávy se nepočítají jako práce.** Je to tvoje vlastní
psaní, leží to ve schránce bez štítku a naplánovaná zpráva vyhoví dotazu až do
svého odeslání. Štítkovat je nemá smysl - úprava konceptu zprávu nahradí novou,
takže štítek to nepřežije. Nevstupují proto do otázky, jestli je okno čisté, a
kotvu nedrží; odečtou se **až po vyhledání**, nikdy jako třetí podmínka, která
by uměla vlákno schovat. Vlákno, kde je jediná neoznačená zpráva koncept, se
nevrací vůbec.

**Naplánovaná zpráva se pozná podle času doručení v budoucnosti** a podle toho,
že je od tebe. Gmail na ni totiž nedává žádný štítek, takže jinak by vypadala
jako běžná došlá pošta z budoucnosti - hlásila by se jako práce a držela kotvu,
dokud by neodešla.

`stale_threads` počítá vlákna, která hledání vrátilo, ale štítek už dávno mají -
vyhledávací index se po zápisu aktualizuje se zpožděním. **Nevrací se**, protože
číst je znovu je práce pro nic.

**Kotvu posuň na `searched_at`, a jedině když je `window_clear` true.** Dokud je
false, je `oldest_unprocessed_at` čas doručení nejstarší čekající zprávy - a
když se to číslo mezi průchody přestane hýbat, něco v okně se nedaří označit a
okno poroste, dokud se na to někdo nepodívá.

### `mg_search_threads`

Hledá v jedné schránce, nebo s `account: "all"` ve všech. Dotaz je plná syntaxe
gmailového hledání a předává se Gmailu nezměněný přes `X-GM-RAW`, takže se nic
nepřekládá a žádná podmínka nemůže cestou vypadnout.

Prohledává se celá schránka, ne doručená pošta: u účtu s filtry většina provozu
do `INBOX` vůbec nevstoupí, takže kdo se dívá jen tam, nevidí, co se ve schránce
děje. Jestli je zpráva archivovaná, se hlásí u každé zprávy jako `in_inbox`, a
bere se to ze štítku, ne ze složky.

`matched_messages` počítá zprávy vlákna, které dotazu odpovídaly, ne velikost
vlákna - vlákno o devíti zprávách s jedním zásahem hlásí `1`.

`unprocessed_matches` počítá, kolika z nich štítek opravdu chybí, a **čte se to
ze samotných zpráv, ne z vyhledávacího indexu.** Gmail ten index aktualizuje
nějakou dobu po zápisu štítku, takže dotaz na neoznačenou poštu dál vrací
vlákna, která byla označená před chvílí. Jestli je ve vlákně něco nového,
rozhoduj podle tohohle čísla, nikdy podle toho, že vlákno mezi výsledky je:
`matched_messages: 3, unprocessed_matches: 0` je zastaralý zásah a přeskočit ho
nic nestojí. To zpoždění může vlákno leda ukázat navíc - schovat nezpracované
neumí - takže tahle cesta chybuje vždycky na bezpečnou stranu.

U každého vlákna se vrací **souhrn nejnovější odpovídající zprávy, ne celá zpráva**:
odesílatel, čas doručení, stav, `in_inbox` a `Message-ID`. Je to schválně úzké -
odpověď na čtyřicet vláken s celým objektem zprávy u každého se přestane vejít do
kontextu a musí se číst ze souboru, čímž nástroj přestane umět to, kvůli čemu
vznikl. **Nic se tím neztrácí**, protože hledání je první ze dvou stupňů: celé
vlákno dá `mg_get_thread` a tělo `mg_get_message`, takže se dotahuje jen to, co za
to stojí. Z téhož důvodu tu není přepínač podrobnosti - dvoustupňové čtení
funguje bez něj a `format` u čtení nevznikl přesně kvůli tomu.

U `account: "all"` **selhání jedné schránky neznamená ztrátu ostatních.**
Schránky, které odpověděly, jsou v `searched`, ty, které ne, jsou vyjmenované
v `failures` i s důvodem, a výsledky zbytku platí. Prázdná odpověď se seznamem
selhání znamená „na tyhle schránky se nešlo dostat", ne „nic tam není".

### `mg_get_thread`

Vrací **všechny** zprávy jednoho vlákna, od nejstarší. `message_count` je
vždycky počet vrácených zpráv; tenhle nástroj nikdy nevrátí část vlákna.

`unprocessed_messages` odpovídá na otázku *„je tu něco nového?"*, aniž by se
musel procházet seznam, a u každé zprávy se to opakuje jako `processed`.

**`processed` je vlastní štítek asistenta, ne příznak přečtení.** Pole `seen`
vedle něj je IMAP příznak `\Seen`, který nastaví člověk tím, že si zprávu otevře
v poštovním klientovi - a protože tenhle server otevírá schránky jen pro čtení,
asistent ho svým čtením nikdy nenastaví. `seen` tedy neříká nic o tom, co
asistent udělal, a u sdílené schránky neříká skoro nic vůbec: nepřečteno tam
neznamená nevyřízeno, protože to mohl vyřídit kolega, aniž by to označil.

Každá zpráva nese dva identifikátory a dvě časové značky, protože se v obou
dvojicích rozcházejí a vybrat jeden by ten rozpor zamlčelo:

| Pole | Význam |
| --- | --- |
| `message_id` | hlavička `Message-ID` - **stabilní** napříč složkami i schránkami, a jediný odkaz, který stojí za uložení |
| `uid` | IMAP UID - platí jen uvnitř složky, ze které se četlo, takže archivace ho změní |
| `received_at` | čas doručení (`INTERNALDATE`); filtruje se podle něj |
| `date_header` | hlavička `Date:`, která se u přeposlaných a naplánovaných zpráv liší |

`state` je jedno z `received`, `sent`, `draft` a `scheduled`. To poslední je
důležité: Gmail drží naplánovanou zprávu s hlavičkou `Date:` nastavenou na čas
plánovaného odeslání, takže bez vlastního stavu vypadá jako zpráva, která už
odešla.

### `mg_get_message`

Jedna zpráva s výřezem těla. Tělo se vrací po výřezech proto, že u dlouhého
vlákna nese každá odpověď citovanou historii, takže text naroste do stovek
kilobajtů; `body_total_length` je celá délka a `body_truncated` říká, jestli
text pokračuje. Přednost dostane prostý text a HTML se vrací tak, jak je, když
prostý text chybí - převod, který potichu něco zahodí, je horší než značky,
které aspoň vidíš.

Těla se dekódují podle znakové sady, kterou zpráva uvádí, takže pošta, která
pořád chodí ve `windows-1250` nebo `iso-8859-2`, si zachová diakritiku.

**Neber citovanou historii v odpovědi jako zdroj kontextu.** Většinou tam je,
ale zaručená není: mobilní klienti ji odstřihávají, přílohy se necitují nikdy, a
nic v ní neřekne, co chybí. Strukturu konverzace dává `mg_get_thread`.

Přílohy se vypíšou s velikostí, ale nestahují se.

### `mg_get_attachment`

Stáhne jednu přílohu, zapíše ji do `download_dir` a vrátí cestu. Obsah se
nevrací přímo v odpovědi, protože příloha běžně měří megabajty. Název souboru ze
zprávy se bere jako nedůvěryhodný vstup: nechá se z něj jen poslední část cesty
a oddělovače i řídicí znaky se nahradí, na každé platformě stejně.

### Štítkovací nástroje

`mg_list_labels` vypíše, co schránka má. `mg_label_message`,
`mg_unlabel_message`, `mg_label_thread` a `mg_unlabel_thread` mění štítky a
nastavený štítek, který ještě neexistuje, se nejdřív založí - Gmail nepřidá
štítek, který nezná, a chybu přitom nehlásí.

**Každá změna se před ohlášením přečte zpátky.** `STORE`, který server přijme a
neprovede, by tě jinak nechal věřit, že zpráva je označená, i když není - a celá
mechanika stojí na tom, že to označení je pravdivé. Čte se `FETCH`em na ty
konkrétní zprávy, **nikdy hledáním** - vyhledávací index se po zápisu štítku
aktualizuje se zpožděním a odpověděl by podle stavu z minulé chvíle.

**Štítkování zpráv bere seznam a vrací výsledek u každé zprávy zvlášť.** Jedno
volání místo čtyřiceti, protože každé volání otevírá vlastní spojení a
přihlášení stojí zhruba tolik co ta práce sama. U každé zprávy pak stojí
`changed`, `already`, `not_found` nebo `failed` - **zpráva, kterou se označit
nepovedlo, nezhatí celé volání ani se neschová v celkovém úspěchu.** Podle
těchto výsledků se rozhoduje, jestli se smí posunout časová hranice průchodu,
takže shrnutí za dávku by na to nestačilo. Označit znovu už označenou zprávu
není chyba, vrátí se `already` - přerušený průchod se dá bez obav zopakovat.

**Štítek na zprávu a štítek na vlákno jsou dvě různé operace, a proto na ně jsou
oddělené nástroje:**

| Kam | Který štítek |
| --- | --- |
| na **zprávu** | prošla tahle zpráva průchodem - platí o téhle jedné zprávě |
| na **vlákno** | klasifikace konverzace (akce, čeká, info, hoří) |

**A to rozdělení vynucuje server, ne kázeň.** `mg_label_message` bere jedině
`processed_label`, `mg_label_thread` jedině klasifikace; opačné použití se odmítne
i s vysvětlením. To nebezpečnější z toho dvojího je štítek o průchodu na vlákně -
Gmail by ho dal i zítřejší odpovědi a ta by se **už nikdy neobjevila jako nová**.

**Vlákno nese jednu klasifikaci a ty se vylučují, takže `mg_label_thread` ji
nastavuje, ne přidává:** zadaná jde na vlákno a všechny ostatní z nastavené sady
v témž volání spadnou. Starou tedy neodebírej předem - dvě volání by nechala
okamžik, kdy je vlákno ve dvou kategoriích nebo v žádné, a vlákno bez kategorie
vypadá jako nevyřízené. `classification_before` a `classification_after`
v odpovědi říkají, z čeho na co.

Gmail štítkem na vlákně označí i zprávy, které do vlákna přijdou později. Štítek
o průchodu by tedy na vlákně označil zítřejší odpověď jako viděnou dřív, než by
ji kdo přečetl - a právě téhle tiché ztrátě to rozdělení brání.

**Štítek na zprávě je filtr příštího průchodu, ne rozsudek.** Odpovídá na
jedinou otázku - prošla tahle zpráva průchodem - a šum ho nese úplně stejně jako
zpráva, která pořád čeká na odpověď: obojí bylo viděné a ani jedno nepotřebuje
číst znovu. Co se ještě má stát, je klasifikace, a ta jde na vlákno.

Zní to jako detail a není. Neoznačená zpráva se vrátí v **každém** dalším
průchodu, a nejčastěji zůstane neoznačená právě pošta, se kterou se nic dělat
nemuselo. Stačí si ten štítek přečíst jako „vyřízeno" a hromada se potichu
naplní přesně tím, na čem záleželo nejmíň.

Vlastní gmailové štítky (`\Inbox`, `\Starred`, `\Trash` a další) se odmítají.
Zapisovat je neznamená štítkovat, ale archivovat, hvězdičkovat nebo mazat, každé
s vlastními důsledky, a ani jedno z toho tyhle nástroje nedělají.

### `mg_set_flags`

Nastaví IMAP příznaky jedné zprávy: `seen`, `flagged` (hvězdička v Gmailu) a
`answered`. Každý předaný příznak se nastaví na danou hodnotu, ty vynechané se
nechají být, a aspoň jeden předat musíš. Příznaky se po změně čtou zpátky, jako
každý jiný zápis tady.

**Tohle není místo, kam si asistent zapisuje vlastní práci.** Příznak `\Seen`
patří tomu, kdo si zprávu otevřel v poštovním klientovi - server otevírá
schránky jen pro čtení, takže čtením zprávy odsud se `\Seen` nikdy nenastaví - a
u sdílené schránky nepřečteno neznamená nevyřízeno. Co prošlo průchodem, patří
do štítku, na zprávu.

**Seznam zapisovatelných příznaků je schválně uzavřený.** `\Deleted` v něm není:
označit ho není změna příznaku, ale mazání, a co Gmail s expunge udělá, rozhoduje
nastavení v účtu uživatele, ne tenhle server. `\Draft` v něm není taky, protože
jeho zrušením by vznikla zpráva, která není ani koncept, ani odeslaná.

### `mg_save_draft`

Uloží koncept do složky Koncepty pomocí IMAP `APPEND`. Nic se neodesílá a žádné
SMTP spojení se neotevírá.

U odpovědi předej `in_reply_to` s hlavičkou `Message-ID` zprávy, na kterou se
odpovídá. **Vlákno, do kterého koncept spadl, se přečte zpátky a porovná
s vláknem, do kterého měl patřit**, a `joined_thread: false` znamená, že se
koncept nepřipojil a odešel by jako samostatná zpráva. To je dobré vědět dřív,
než se odešle, ne potom.

`from_alias` nastaví hlavičku `From` na jinou adresu. Musí to být alias už
ověřený v Gmailu; tenhle server ověřit žádný neumí a je to jednorázová věc
v nastavení Gmailu, ne něco, co by poštovní protokol zvládl.

**Pod odpověď se vloží citace zprávy, na kterou odpovídá** - `quote_original` je
zapnuté a vypíná se jen tehdy, když má odpověď dorazit holá. Cituje se **jen ta
jedna zpráva**: svou vlastní historii už v sobě nese, takže se vlákno nabaluje
samo, přesně jako v poštovním klientovi. Prostá a HTML strana se staví každá ze
své předlohy, takže citace neztratí formátování původní zprávy.

**Vložené obrázky citaci nepřežijí.** Jsou to přílohy, na které HTML odkazuje
přes `cid:`, a přílohy se s citací nepřenášejí - odkaz tedy nikam nevede. Gmail
má celou zprávu na svých serverech a udržet je umí, tenhle server ne.

**Koncept se ukládá bez příznaku `\Draft`**, což jde proti tomu, jak se IMAP
obvykle čte. Gmail ho na svých konceptech nemá také - koncept napsaný ve webovém
rozhraní leží ve složce jen s `\Seen` a konceptem ho dělá ta složka. **Zpráva,
která ten příznak nese, se Gmailu jeví jako cizí a schová celé její tělo pod
tlačítko „zobrazit oříznutý obsah"**, jako by to byla citovaná historie. Koncept
pak vypadá prázdný a uživatel musí kliknout, aby našel vlastní text.

**Tělo piš jako HTML ve tvaru, který skládá Gmail sám** - vnější
`<div dir="ltr">`, každý odstavec jako `<div>`, prázdný řádek jako
`<div><br></div>`. Se značkami `<p>` nastane totéž schování jako s příznakem
`\Draft`, protože je Gmail nepovažuje za vlastní text.

> **Pozor na režim prostého textu.** Když ho má uživatel v okně psaní zapnutý,
> Gmail HTML část zahodí a pracuje jen s prostým textem - **ten pak při odeslání
> zalomí natvrdo uprostřed vět.** Nepozná se to ničím jiným než nápisem „Prostý
> text" v záhlaví okna, a vypadá to jako chyba serveru. Není.

### `mg_list_drafts`

Vypíše koncepty čekající ve schránce, od nejnovějšího.

U každého konceptu se zopakuje kontrola `joined_thread`, kterou dělá
`mg_save_draft`, **ale proti schránce v aktuálním stavu**, ne že by se věřilo
tomu, jak to dopadlo při ukládání. Koncept se od vlákna může odtrhnout
dodatečně - stačí editace v jiném klientovi - a odtržený koncept vypadá ve
výpisu úplně obyčejně až do chvíle, kdy odejde jako samostatná zpráva.

`joined_thread: null` znamená, že koncept není odpověď, nebo že zpráva, na
kterou odpovídal, už ve schránce není a nebylo se s čím porovnávat. `warning`
řekne, která z těch dvou možností to je.

### `mg_send_message`

Odešle zprávu přes SMTP a ověří kopii v Odeslané poště. **Tohle se nedá vzít
zpátky**, takže je to nejvíc pojištěný nástroj tady.

**Port se vybírá předem, ne podle chyby.** Hostingy, firemní sítě a hotelové
wifi port 465 často blokují. Bez `smtp_port` server před prvním odesláním ze
schránky jen zkusí přihlášení na 465, a když se tam nepřipojí, na 587 - nic
přitom neposílá. Fungující port si pamatuje. Samotné odeslání pak jde jedním
portem a **po chybě se nikdy neopakuje jiným**: spojení může spadnout ve
chvíli, kdy Gmail zprávu už přijal, a druhý pokus by ji doručil dvakrát.
Chyba, při které se nic neodeslalo, to říká výslovně; chyba uprostřed
odesílání říká, že zpráva odejít mohla a že se má nejdřív zkontrolovat
Odeslaná pošta. Výsledek hlásí `smtp_port`, přes který zpráva šla.

**Dvě pojistky, obě výchozím stavem zavřené.** Schránka odešle jedině tehdy,
když to `can_send` dovolí, a výchozí stav je `false`; když je nastavený
`allowed_recipients`, vynucuje se přesně a prázdný seznam nedovolí nikam.

**Dva výsledky, hlášené zvlášť.** `accepted` a `rejected` říkají, ke kterým
adresátům zpráva dorazila a ke kterým ne; `sent_copy` říká, jestli je k nalezení
v Odeslané poště. **Chybějící kopie neznamená neúspěšné odeslání:** když je
`sent_copy.saved` rovno `false`, zpráva stejně odešla a **nesmí se poslat
znovu**, jen po ní v Odeslané nezůstane stopa a příští průchod poštou o ní
nebude vědět. Co stojí za pozornost, se zopakuje ve `warning`.

**Kopii si Gmail ukládá sám.** SMTP o schránkách neví nic, takže poštovní klient
běžně odešle přes SMTP a pak si kopii přidá do Odeslané přes IMAP - jenže Gmail
je výjimka: všechno, co projde přes `smtp.gmail.com`, se do Odeslané uloží
automaticky a vypnout to nejde. Vlastní přidání navíc by zprávu nahrálo podruhé
a Gmail může takový souběžný zápis odmítnout, což by se pak hlásilo jako
chybějící kopie, která ve skutečnosti je.

Kopie se proto **ověřuje, nezapisuje**: po odeslání se v Odeslané hledá
`Message-ID`, chvíli opakovaně, protože Gmail ji nemusí založit v tu vteřinu,
kdy se odeslání vrátí. Teprve když tam není, přidá ji server sám.
`sent_copy.filed_by` řekne, co z toho nastalo - `gmail`, nebo `server`. Přidají
se přesně ty bajty, které odešly, protože se zpráva skládá jednou a týž buffer
jde do SMTP i do `APPEND`.

**Odeslat existující koncept přes SMTP nejde** a tenhle server nepředstírá opak.
Protokol takovou operaci nezná: poslat, co je v konceptu, znamená složit tutéž
zprávu znovu a původní koncept pak uklidit.

> **Při tom skládání znovu dej `quote_original: false` a `signature: false`.**
> Citace i podpis jsou v tom konceptu už vloženy - když se nechají zapnuté,
> odejde historie i patička dvakrát.

**Ten úklid dělá asistent a dělá ho až po odeslání, nikdy před ním.** To pořadí
je jediné bezpečné. Když selže mazání, zůstane v Konceptech duplikát - je
vidět, dá se smazat a nic se neztratilo. Při opačném pořadí by selhané odeslání
nechalo zprávu nenapsanou a koncept už smazaný, tedy text pryč a není z čeho ho
vzít zpátky. Uklidit tenhle koncept je správně: uživatel řekl „pošli", ne „nech
tam kopii". Proto je to jediná výjimka z pravidla u `mg_trash_message`, že se
poštou neuklízí bez vyžádání.

**Koncept, který zůstane v Konceptech po odeslání, není normální stav.** Znamená
to, že mazání selhalo, a stojí za to si toho všimnout - právě proto se maže až
jako druhé.

### Přeposlání

**Nástroj na přeposlání tu není a nebude.** IMAP ani SMTP takovou operaci
neznají: předat zprávu dál je z pohledu protokolu **nová zpráva**, ne úkon nad
tou původní. Nechybí tu tedy funkce, jen se jmenuje jinak.

Předává se dál takhle:

1. Odpověz do vlákna přes `mg_send_message` (nebo `mg_save_draft`) s `in_reply_to`
   nastaveným na `Message-ID` původní zprávy a s **jiným adresátem**.
2. **Citace jde s sebou sama.** `quote_original` je ve výchozím stavu zapnuté
   a vloží pod odpověď tu zprávu, na kterou se odpovídá - s řádkou „Dne …
   napsal:" a odsazeným textem, tak jak to dělá poštovní klient. Do `body`
   a `html_body` piš jen nový text; když do nich citaci napíšeš taky, bude ve
   zprávě dvakrát.

3. **Přílohy vezmi s sebou ručně.** Samy nepřejdou: stáhni je přes
   `mg_get_attachment` a předej uložené soubory v `attachments`.

**Když přílohy nepřidáš, řekni to** - místo abys poslal mail, o kterém si
adresát myslí, že v něm faktura je.

**Přiložit jde jen ze složek, které vyjmenuje `attachment_dirs`**, a když žádná
nastavená není, přílohy nejdou vůbec. Gmail navíc odmítne zprávu nad 25 MB
a kódování přílohy zvětší zhruba o třetinu, takže dlouhé vlákno s přílohami se
do jedné zprávy vejít nemusí.

### `mg_trash_message`

Přesune jednu zprávu do koše. Jednu zprávu, nikdy celé vlákno: štítkování má
nástroj na vlákno proto, že klasifikace platí o konverzaci, kdežto vyhazování
pošty ne.

**Nic tady nemaže poštu natrvalo.** Gmail drží zprávu v koši 30 dní a do té doby
ji jde obnovit.

**Je to pořád schránka uživatele**, takže se sem sahá, když o to řekl, ne na
uklízení. Že zpráva prošla průchodem, se zaznamenává štítkem přes
`mg_label_message` a zpráva zůstane, kde je. Jediná výjimka je koncept, jehož
text právě odešel přes `mg_send_message` - ten uklidí asistent sám, viz výš.

**Zprávu přesouvá, místo aby ji označil `\Deleted`**, a ten rozdíl není
kosmetický. Co Gmail udělá se zprávou, kterou klient označí jako smazanou a
provede expunge, rozhoduje nastavení v IMAP volbách uživatele - archivovat,
dát do koše, nebo smazat navždy - takže totéž volání by na třech účtech udělalo
tři různé věci a jedna z nich je nevratná. `MOVE` do složky, kterou server sám
hlásí jako `\Trash`, dělá všude jednu věc. (Gmail rozšíření `MOVE` ohlašuje až po
přihlášení, takže seznam schopností přečtený před ověřením ho neukáže.)

Zpráva se po přesunu v koši vyhledá, takže neprovedený přesun je chyba, ne
veselé hlášení. Zopakovaný požadavek na zprávu, která už v koši je, chyba není:
výsledek řekne `moved: false` a nic se nezmění.

## Bezpečnost

- **Heslo aplikace otevírá celou schránku a nedá se zúžit.** Gmailový IMAP
  vyžaduje plný rozsah `https://mail.google.com/`, takže varianta jen pro čtení
  neexistuje. Jakékoli omezení musí být v tomhle serveru.
- Hesla se nikdy nezapisují do logu a nikdy je nevrátí žádný nástroj.
- Pro čtení se schránky otevírají **jen pro čtení**, takže se prohlédnutím
  zprávy nic ve tvojí schránce neoznačí jako přečtené.
- Diagnostika jde jenom na stderr; na stdout je MCP protokol.
- Odesílání je u každé schránky vypnuté, dokud ho konfigurace nezapne, a
  nastavený ale prázdný `allowed_recipients` nedovolí nikam, ne kamkoli.

## Licence

Apache License 2.0 - viz [LICENSE](LICENSE) a [NOTICE](NOTICE).
