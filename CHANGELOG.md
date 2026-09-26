# Změny

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
čísla verzí ze [Semantic Versioning](https://semver.org/lang/cs/).

## [Nevydáno]

- Návod pro asistenta podle testovací instalace na Windows (desktopová
  aplikace Claude, uživatel bez práv správce): krok 9 má cestu přes `.mcp.json`
  v kořeni vaultu; zástupný text hesla jako doslovný blok a kontrola, která
  pozná i jeho překlep; `classification_labels` se nesmí vynechat a kontrolní
  seznam je ověřuje; krok 4 výslovně jako rozhovor; `git check-ignore` jen v
  repozitáři, mimo něj se pravidlo připraví dopředu. README: `.mcp.json` a
  Node.js bez instalace.

- Heslo aplikace se smí zapsat s mezerami, jak ho ukazuje Google. Když je
  heslo (z `password` i z `password_env`) po odstranění bílých znaků přesně 16
  malých písmen, server použije očištěnou podobu; jiné heslo nechá beze změny.

- Návod pro asistenta v `docs/pro-asistenta.md`: nastavení s uživatelem,
  kotva průchodu, postup průchodu, doporučené klasifikace, bezpečnost a
  psaní konceptů. Balíček ho obsahuje.
- Instrukce serveru říkají, že je stavěný pro Miládku, a odkazují na návod
  absolutní cestou (když soubor chybí, odkazem na GitHub).
- Návod pro asistenta přepracovaný na průvodce nastavením krok za krokem:
  kontrola Node.js a gitu, instalace, heslo aplikace vložené uživatelem do
  souboru mimo chat, kontrola a úpravy `config.json` bez vypsání hesel,
  zkušební spuštění, připojení do Claude Code, ověření s tabulkou chyb, kotva,
  první průchod, pozdější změny a řešení problémů. Průchod výslovně říká, že
  po označení se volá znovu bez `page_token`, dokud nepřijde `window_clear: true`.
- Instrukce serveru upozorňují, že `config.json` se nemá číst celý, protože
  může obsahovat hesla.
- README: jak vidět hlášku serveru, který se v Claude Code nepřipojí, a že po
  `claude mcp add` je potřeba Claude Code restartovat.
- Doporučené umístění konfigurace změněné: s Miládkou
  `.miladka/secrets/multigmail/config.json` ve vaultu (celá `.miladka/secrets/`
  v `.gitignore`, ověření `git check-ignore -v`, práva 700 a 600), bez Miládky
  mimo jakýkoli repozitář, třeba `~/.config/multigmail/`. Podpisy do modulu
  pošty s relativní cestou od konfigurace. Návod i obě README.
- Návod pro asistenta doplněný o zkušenosti z provozu: zálohy konfigurace jen
  v `secrets`, co dělat, když soubor s hesly unikne do gitu, hledání ve vaultu
  bez `secrets`, reconnect po změně a starý proces serveru, opakování
  `mg_label_message` při nahodilém `failed`, kotva ze `searched_at` v UTC kolem
  půlnoci, úklid klasifikace dvěma hledáními s `{…}`, proč štítek na zprávě a
  klasifikace na vlákně, schránky bez klasifikací, vlastní štítek o zpracování
  pro každého asistenta, hromadné notifikace, souhrny „když jste byli pryč",
  režim prostého textu v Gmailu, „odešli to" jako koncept, citlivé údaje mimo
  vault, heslo aplikace se ruší jen v účtu Google. Na konci kontrolní seznam
  po nastavení.

## [0.1.0] - 2026-09-26

První veřejná verze.

- Přístup k několika gmailovým schránkám naráz přes IMAP a heslo aplikace,
  každá pod krátkým jménem.
- Hledání v jedné schránce nebo ve všech naráz (`mg_search_threads`), plná
  gmailová syntaxe dotazu.
- Průchod novou poštou (`mg_next_pass`) s kotvou, kterou drží klient, a
  štítkem o zpracování na každé zprávě.
- Čtení celých vláken, jednotlivých zpráv po výřezech a stahování příloh.
- Klasifikační štítky na vlákna a štítek o zpracování na zprávy; nástroje
  sahají jen na štítky vyjmenované v konfiguraci.
- Režimy průchodu podle schránky: vlastní, sdílená týmová (`work_scope`,
  `assignment_labels`, `my_label`) a schránka pro automaty (`unread_only`,
  `processed_label: null`).
- Příznaky přečteno, hvězdička a zodpovězeno (`mg_set_flags`).
- Koncepty včetně odpovědí ve vlákně, s kontrolou, že koncept ve vlákně
  zůstal.
- Odesílání přes SMTP s ověřením kopie v Odeslané poště. Výchozím stavem
  vypnuté (`can_send`), volitelně omezené na povolené adresáty.
- Podpisy a aliasy v konfiguraci, citace původní zprávy v odpovědi
  (`quote_locale`).
- Přílohy v odchozí poště jen z vyjmenovaných adresářů, výchozím stavem
  vypnuté.
- Přesun zprávy do koše, nikdy trvalé mazání.
- Instrukce pro asistenta poskládané z konfigurace a varování, když
  konfigurační soubor leží v gitu neignorovaný.
