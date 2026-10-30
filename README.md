# Martian Chess

Ein uraltes Brettspiel für zwei, an einem Bildschirm – schwebend über einem Wolkenmeer auf dem roten Planeten.

**Spielen:** https://franzroelle888.github.io/martian-chess/

## Spielprinzip

Farben bedeuten nichts. Dir gehören alle und nur die Figuren, die gerade in deiner Zone stehen. Wer über den Kanal zieht und dort eine Figur schlägt, bekommt ihre Punkte – die eigene Figur gehört danach dem Gegenüber.

| Figur   | Zug                                   | Punkte |
|---------|---------------------------------------|--------|
| Bauer   | 1 Feld diagonal                       | 1      |
| Drohne  | 1–2 Felder waagerecht oder senkrecht  | 2      |
| Königin | beliebig weit in jede Richtung        | 3      |

- **Field Promotion:** Ohne Königin verschmelzen Drohne + Bauer zur Königin, ohne Drohne zwei Bauern zur Drohne.
- **Kein Zurückweisen:** Eine gerade herübergezogene Figur darf nicht sofort auf ihr Ausgangsfeld zurück.
- **Spielende:** Sobald eine Zone leer ist. Höchste Punktzahl gewinnt, bei Gleichstand gewinnt, wer das Spiel beendet hat.
- **Die Uhr:** Stockt das Spiel, kann sie ausgerufen werden – nach sieben Zügen ohne Schlagen ist Schluss.

## Steuerung

Figur anklicken, dann Ziel anklicken. `Esc` hebt die Auswahl auf, `Strg+Z` nimmt einen Zug zurück, `M` schaltet den Ton, `?` öffnet die Regeln. Spielernamen lassen sich oben durch Anklicken ändern.

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt: [three.js](https://threejs.org) für die 3D-Szene, Web Audio für den generativen Klang. Die Spielregeln stecken in `rules.js`, Szene und Ablauf in `main.js`.

---

Martian Chess wurde 1997 von Andrew Looney entworfen ([Looney Labs](https://www.looneylabs.com)). Dies ist eine private, nicht-kommerzielle Umsetzung.
