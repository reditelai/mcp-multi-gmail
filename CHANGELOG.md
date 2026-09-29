# Změny

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
čísla verzí ze [Semantic Versioning](https://semver.org/lang/cs/).

## [Nevydáno]

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
