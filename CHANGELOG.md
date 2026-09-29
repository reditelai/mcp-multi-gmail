# Změny

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
čísla verzí ze [Semantic Versioning](https://semver.org/lang/cs/).

## [Nevydáno]

- Odesílání i přes port 587 (STARTTLS). Nová volba `smtp_port` (465 nebo 587) u schránky i pro celý soubor. Bez ní server zkusí 465, a když se nepřipojí, přejde na 587 - hostingy, firemní sítě a hotelové wifi port 465 často blokují.
- Na navázání spojení se čeká 10 s místo minuty a na další port se přechází jen tehdy, když se spojení vůbec nenavázalo, takže nehrozí dvojí odeslání. Výsledek odeslání hlásí `smtp_port`, přes který zpráva odešla.
- Když neprojde žádný port, chyba říká, že se nic neodeslalo a že port nejspíš blokuje síť - dřív tvrdila, že Gmail zprávu odmítl.

## [0.1.1] - 2026-09-28

První vydaná verze: Miládka pracuje s víc Gmail schránkami naráz.

- Víc schránek (Gmail i Google Workspace) v jednom připojení, každá pod krátkým jménem.
- Průchod novou poštou s kotvou, štítkem na každé zprávě a tříděním konverzací.
- Hledání v jedné schránce nebo ve všech naráz, čtení celých vláken a příloh.
- Koncepty odpovědí s podpisem, odesílání jen tam, kde ho uživatel povolil.
- Návod pro asistenta (`docs/pro-asistenta.md`): nastavení s uživatelem krok za krokem, navázání na Miládku 1.8 a aktualizace podle vydaných verzí.
