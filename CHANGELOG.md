# Změny

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
čísla verzí ze [Semantic Versioning](https://semver.org/lang/cs/).

## [Nevydáno]

## [1.5.0] - 2026-10-08

Server je doplněk Miládky a běží jen v její složce.

- Vydaný soubor se spustí jen ze složky doplňků Miládky (`.doplnky/mcp-multi-gmail/`, anglicky `.addons/`) ve složce, která má `.miladka/VERSION`. Jinde nenaběhne a česky i anglicky napíše, že je to doplněk Miládky a ať si ji uživatel pořídí na miladka.cz (v režimu `--wait` jako `chyba:` s kódem 6). Sestavení ze zdrojového kódu kontrolu nemá (Karel 8. 10. 2026).
- README a návod jen pro Miládku: pryč rychlý start bez ní, Claude Desktop, `~/.config` a registrace příkazem `claude mcp add`. Server se zapisuje jen do `.mcp.json` ve vaultu.
- Návod: nový oddíl „Přesun do složky Miládky (verze 1.5)" pro instalace z doby před 1.1, kontrola místa v kroku 1 aktualizace.
- Návod, „Hlídač a automatický režim oprávnění": změna popisu prostředí platí hned, v téže konverzaci (ověřeno 30. 9. 2026).

### Při aktualizaci

- **Ještě před výměnou souboru** ověř místo: cesta k serveru v `.mcp.json` musí vést do `.doplnky/mcp-multi-gmail/` a vault musí mít `.miladka/VERSION`. Jinak nová verze nenaběhne. Když leží jinde, postupuj podle návodu, oddíl „Přesun do složky Miládky (verze 1.5)", místo kroků 3 a 4 aktualizace.
- Nastavení se nemění.

## [1.4.1] - 2026-09-30

Automatický režim oprávnění už nemá zastavovat hlídač pošty: návod doplní řádek do popisu prostředí.

- Návod, „Hlídač pošty": se souhlasem uživatele doplnit do `autoMode.environment` v uživatelském nastavení Claude Code řádek, že spuštění hlídače s `--wait` a posun kotvy jsou běžný provoz. Bez něj klasifikátor spuštění hlídače občas zablokuje a hlídač potichu nenaběhne (Věrka 30. 9. 2026). Zápis jde jen přes „Accept edits", nastavení Claude Code se bez uživatele měnit nemá. Příkaz nastavení nevypíše, nepřidá řádek dvakrát a bez vlastního seznamu začne `"$defaults"`, ať zůstanou výchozí pravidla.

### Při aktualizaci

- Když uživatel používá hlídač pošty, se souhlasem doplň řádek do popisu prostředí automatického režimu podle návodu, „Hlídač pošty", odstavec „Hlídač a automatický režim oprávnění". Potřebuje „Accept edits".

## [1.4.0] - 2026-09-30

Nastavení schránek se může zálohovat: hesla aplikací jsou v samostatném souboru, který se nezálohuje.

- Nový klíč `passwords_file`: soubor s hesly aplikací, u každé schránky krátké jméno a heslo. Schránka bez `password` a `password_env` bere heslo z něj. V Miládce je nastavení ve `system/multigmail.json` (zálohuje se s vaultem) a hesla v `.miladka/secrets/multigmail/hesla.json` (nezálohuje se). Kdo přijde o počítač, přijde jen o hesla (Karel 30. 9. 2026).
- Relativní cesta k souboru s hesly se ve složce doplňků Miládky počítá od kořene vaultu. Chyby souboru s hesly jmenují soubor, nikdy jeho obsah; zástupný text `SEM_VLOZ_HESLO_APLIKACE` server pozná a řekne, že heslo chybí.
- Varování o gitu hlídá jen soubory, ve kterých hesla opravdu jsou. Instrukce serveru říkají, že nastavení bez hesel se čte a upravuje běžně.
- Návod: nové umístění souborů, doplněk si sám ověří v `.gitignore` vaultu `.doplnky/`, `vstupy/*` s výjimkou `!vstupy/.gitkeep` a `.miladka/secrets/`, a nepředpokládá, že to zařídil balíček nebo jiný doplněk. Nový postup „Převod na oddělená hesla (verze 1.4)".
- Návod: nový oddíl „Nový počítač nebo obnova ze zálohy". Nastavení a kotva přijdou zálohou, program a hesla se nastaví znovu.
- Nevložené heslo (zůstal zástupný text) je varování, ne chyba: ta schránka se nepřihlásí, ostatní fungují. Nastavení uložené s BOM se načte, `--version` vypíše verzi bez nastavení. Popisy nástrojů a hlášky místo odpojení serveru radí `mg_reload_config`.

### Při aktualizaci

- Ověř `.gitignore` vaultu podle kroku 3 návodu. Starší návod radil celé `vstupy/`, které vylučuje `vstupy/.gitkeep` z instalátoru Miládky: nahraď ho `vstupy/*` a `!vstupy/.gitkeep`.
- Staré uspořádání (`.miladka/secrets/multigmail/config.json` s hesly uvnitř) funguje dál. Když server leží ve `.doplnky/` a je zapsaný v `.mcp.json`, nabídni převod podle návodu, oddíl „Převod na oddělená hesla (verze 1.4)": **výjimečně hned po výměně souboru serveru, ještě před novou konverzací**, ať stačí jedna. Převod hesla nevypíše a uživatel nic nevkládá; mění `.mcp.json` (cesta za `--config`), takže potřebuje „Accept edits".
- Oddíl „Práce s config.json bez vypsání hesel", na který odkazují starší sekce, je teď „Soubor s hesly bez vypsání" (i pro staré uspořádání). `config.json` ze starších sekcí je po převodu `system/multigmail.json`.
- Po nové konverzaci spusť hlídače pošty s cestou za `--config` z `.mcp.json`.

## [1.3.1] - 2026-09-30

Aktualizace ve správném pořadí: nová verze platí až v nové konverzaci, změny nastavení se dělají až potom.

- Návod, „Aktualizace serveru": předem říct, že nová verze potřebuje novou konverzaci (v terminálu `/mcp` a Reconnect), a změny nastavení z „Při aktualizaci" dělat až v ní. Dřív je asistent zapsal hned a běžící starý server je odmítl, což vypadalo jako chyba (Věrka při aktualizaci na 1.3.0).
- Neznámý klíč v `config.json` hláška vysvětlí: nejspíš patří novější verzi a běží ještě stará, jinak je to překlep. Kontrola zůstává přísná, chytá překlepy.

### Při aktualizaci

- Nastavení se nemění. Po nové konverzaci spusť hlídače pošty znovu, ať běží z nové verze.

## [1.3.0] - 2026-09-30

Nastavení hlídače na jednom místě v `config.json` a o dotaz míň na každé probuzení.

- Co hlídač pošty hlídá a kdy, je v `config.json`: u schránky `watch: true`, pro celý soubor `watch_hours` (třeba `"9-19"`) a `watch_interval`. Asistent předá kotvy všech schránek a hlídač si vezme hlídané. `mg_list_accounts` nastavení ukazuje, takže soubor s hesly není potřeba číst. Příkazové `--hours` a `--interval` platí dál a mají přednost.
- `mg_label_message` bere volitelně `since` a vrátí stav okna po označení (`window_clear`, `searched_at`). Druhý průchod jen kvůli `window_clear` odpadá, šetří to jeden celý dotaz modelu na každé probuzení.
- Návod: průchod víc schránek najednou v jednom kroku, hook při startu konverzace s odkazem na kotvy a `config.json`, a nepřidávat druhý hook, když ho uživatel už má vlastní.

### Při aktualizaci

- Když hlídač běží s `--hours` nebo jen pro některé schránky, se souhlasem uživatele přenes nastavení do `config.json` („Práce s config.json bez vypsání hesel"): `watch: true` u hlídaných schránek, `watch_hours`, případně `watch_interval`. Pak `mg_reload_config`, v `mg_list_accounts` ověř `watch`, a spusť hlídače s kotvami všech schránek bez `--hours`.
- Uprav text hooku hlídače pošty v `.claude/settings.json` podle návodu (oddíl „Hlídač pošty"). Když máš vlastní hook se stejným pokynem, druhý nepřidávej.
- Průchod od teď s `since` u posledního `mg_label_message` místo druhého `mg_next_pass`.

## [1.2.1] - 2026-09-30

Opravy z revize hlídače pošty: hlídač si všimne i pošty, která přišla, když nehlídal, a přerušené spojení už neshodí server.

- Hlídač si pamatuje, o které poště už dal vědět (`wait-known.json` vedle serveru, jen Message-ID). Dřív bral za známé všechno, co čekalo při první kontrole, takže ho nevzbudila noční pošta s `--hours`, pošta během průchodu ani mezi konverzacemi.
- Přerušené spojení s Gmailem (ECONNRESET, vypršení) už neukončí proces. Dřív spadl hlídač i server uprostřed konverzace.
- Problém jedné schránky nezastaví hlídání ostatních a jejich nová pošta má přednost. Výpadek sítě hlídač nikdy neukončí.
- Převzatý hlídač se už neprobudí na tutéž poštu podruhé. Zastavení zvenku skončí hned. Stejná schránka dvakrát v `--since` je chyba spuštění.
- Vlastní pošta odeslaná z telefonu hlídače nebudí.
- Chyba v JSONu nastavení už nevypíše okolní text, kde mohl být kus hesla.

### Při aktualizaci

- Nastavení se nemění. Po výměně souboru (nová konverzace) spusť hlídače znovu. První spuštění tě vzbudí, když v okně čeká pošta, o které hlídač ještě neví.

## [1.2.0] - 2026-09-30

Hlídač pošty: server sám hlídá novou poštu a asistenta probudí, až přijde. Prázdná kontrola nestojí žádné tokeny.

- Režim hlídání `--wait --since jmeno=kotva …`: asistent ho spustí na pozadí, server se každých 5 minut zeptá Gmailu přesně na totéž co průchod a skončí, až přijde nová pošta. Nahrazuje pravidelný průchod přes cron, který budil model i tehdy, když nic nepřišlo. Volby `--hours 9-19` (jen v pracovní době) a `--interval`. Zrušené heslo aplikace hlásí, výpadek sítě přečká. Stejné kódy konce jako hlídač WhatsAppu.
- Nový nástroj `mg_reload_config`: po změně nastavení, hesla nebo podpisu ho server načte hned, bez nové konverzace. Aplikace Claude na Windows server znovu připojit neumí.
- Návod: hlídač v každé konverzaci přes hook při startu konverzace, u zápisu `.mcp.json` rovnou „Accept edits" a kde je přepínač.

### Při aktualizaci

- Nastavení se nemění.
- Když má uživatel pravidelný průchod přes cron (`CronList`, zápis ve vaultu třeba `system/cron.md`), se souhlasem ho nahraď hlídačem pošty podle návodu, oddíl „Hlídač pošty": zruš úlohu (`CronDelete`) a zápis, spusť hlídače a přidej jeho hook do `.claude/settings.json`. Zápis do `settings.json` může chtít „Accept edits".
- Po změně nastavení od teď `mg_reload_config` místo reconnectu.

## [1.1.0] - 2026-09-29

Server je jeden soubor ve složce Miládky: instalace bez npm a gitu, přílohy do `vstupy/prilohy`.

- Každý release nese `mcp-multi-gmail.mjs` se všemi knihovnami uvnitř a `SHA256SUMS`. Stačí Node.js 20+, žádné `npm install`, žádný git.
- V Miládce server patří do `<vault>/.doplnky/mcp-multi-gmail/` a registruje se v `.mcp.json` s cestami relativními ke kořeni vaultu, takže se stěhuje s ním.
- Bez nastaveného `download_dir` ukládá server v Miládce přílohy do `vstupy/prilohy` ve vaultu (anglicky `inbox/attachments`), jinde dál do dočasné složky systému.
- Úvodní hláška serveru ukazuje, kam jdou přílohy.

### Při aktualizaci

- Nastavení se nemění, `config.json` zůstává kde je.
- **Převod na jeden soubor** (z instalace klonem nebo ZIPem, typicky `~/mcp-multi-gmail`), se souhlasem uživatele:
  1. Ověř, že `.doplnky/` a `vstupy/` jsou v `.gitignore` vaultu (návod, krok 3). Bez toho nepokračuj.
  2. Stáhni a ověř `mcp-multi-gmail.mjs` do `VAULT/.doplnky/mcp-multi-gmail/` (krok 3) a vyzkoušej ho (krok 8).
  3. Přepiš registraci na relativní cesty v `.mcp.json` (krok 9, cesta A). Starou registraci najdi (`claude mcp list`, jméno bývá `multi-gmail` i `multigmail`) a odeber (`claude mcp remove JMÉNO --scope user`, nebo starý záznam v `.mcp.json`). Nový server naběhne až v nové konverzaci.
  4. Nová konverzace, ověř přihlášení (krok 10). Stažené přílohy teď jdou do `vstupy/prilohy`, pokud `download_dir` není nastavený.
  5. Starou složku serveru smaž až po ověření a jen se souhlasem - **ne, když je to vývojový klon repozitáře** (má `.git` a uživatel v něm pracuje).


## [1.0.0] - 2026-09-29

Stabilní verze: odesílání funguje i v sítích, které blokují port 465, a nikdy nepošle zprávu dvakrát.

- Od 1.0.0 drží nástroje a klíče konfigurace zpětnou kompatibilitu. Nekompatibilní změna zvedne první číslo verze a changelog popíše převod.

- Odesílání i přes port 587 (STARTTLS). Nová volba `smtp_port` (465 nebo 587) u schránky i pro celý soubor. Bez ní server před prvním odesláním zkusí přihlášení na 465 a když se nepřipojí, použije 587; nic přitom neposílá a fungující port si pamatuje.
- Po chybě uprostřed odesílání se zpráva neposílá znovu jiným portem. Chyba řekne, jestli se nic neodeslalo, nebo jestli zpráva odejít mohla a je potřeba zkontrolovat Odeslanou poštu.
- Na navázání spojení se čeká 10 s místo minuty. Výsledek odeslání hlásí `smtp_port`.
- `mg_list_accounts` s `verify: true` ověří u schránek s povoleným odesíláním i odesílání a vrátí port, přes který jde.

### Při aktualizaci

- Nastavení se nemění, `smtp_port` není potřeba doplňovat.
- Po aktualizaci zavolej `mg_list_accounts` s `verify: true`. Když schránka s povoleným odesíláním hlásí selhání s `check: "smtp"`, postupuj podle tabulky v kroku 10 návodu (`docs/pro-asistenta.md`).

## [0.1.1] - 2026-09-28

První vydaná verze: Miládka pracuje s víc Gmail schránkami naráz.

- Víc schránek (Gmail i Google Workspace) v jednom připojení, každá pod krátkým jménem.
- Průchod novou poštou s kotvou, štítkem na každé zprávě a tříděním konverzací.
- Hledání v jedné schránce nebo ve všech naráz, čtení celých vláken a příloh.
- Koncepty odpovědí s podpisem, odesílání jen tam, kde ho uživatel povolil.
- Návod pro asistenta (`docs/pro-asistenta.md`): nastavení s uživatelem krok za krokem, navázání na Miládku 1.8 a aktualizace podle vydaných verzí.
