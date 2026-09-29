# Změny

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
čísla verzí ze [Semantic Versioning](https://semver.org/lang/cs/).

## [Nevydáno]

## [0.2.0] - 2026-09-29

Odesílání funguje i v sítích, které blokují port 465, a nikdy nepošle zprávu dvakrát.

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
