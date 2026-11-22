# Issue-Tracking

Übernommene Version: `github-tracking-v1`, schlank für ein Repository mit einem Entwickler.
Dieses Dokument ist ohne die Vorlage vollständig.

## Ort

GitHub-Issues in `dom8509/orca-workflow-status`, gelesen und geschrieben mit der `gh` CLI. Es gibt
keinen separaten Umsetzungsplan; der Umfang steht im Issue. Status lebt nur in GitHub.

## Zuständigkeiten

- Nutzer: gibt Umfang und Plan frei, nimmt ab, genehmigt Merge und Umfangserweiterung.
- Agent: setzt das Issue im freigegebenen Umfang um und dokumentiert Nachweise im Issue und im PR.

## Pflichtfelder eines Umsetzungs-Issues

Issue Form `.github/ISSUE_TEMPLATE/umsetzung.yml`: Ziel und Kontext, Umfang und Ausschlüsse,
Akzeptanzkriterien mit ID (`AK1`, `AK2`, …) und Nachweisart je AK, Nutzerabnahme erforderlich
(ja/nein).

## Listen lesen

Jeder Lesezugriff auf eine Liste liest alle Seiten: `gh api --paginate`, oder `gh issue list`
mit einem `--limit` über der Gesamtzahl.

## Abschluss

- Commits und PR-Beschreibungen verweisen mit `Refs #<Nr>`. `Closes`, `Fixes` und `Resolves`
  bleiben draußen, weil GitHub das Issue sonst beim Merge schließt.
- Die PR-Beschreibung enthält eine Nachweistabelle, eine Zeile je AK, und die Zeile
  „Ausstehende Abnahmen".
- Ein Issue schließt erst, wenn jedes AK im Issue nachgewiesen und die verlangte Nutzerabnahme
  dokumentiert ist. Ein offenes oder unbelegtes AK hält es offen; der Abschlusskommentar nennt es.
- Ein Handtest steht als Kommentar mit Datum, Build (Commit-SHA), Umgebung (Orca-Version),
  Prüfer, Ergebnis je AK und Artefakt (Screenshot).
