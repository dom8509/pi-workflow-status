# orca-workflow-status

Orca-Plugin, das für jeden Agenten den Pi-Workflow und die Phase anzeigt. Aufbau und Befehle
stehen in `README.md`; die Plugin-Regeln von Orca liefert `orca skills get orca-plugin-authoring`.

## Tracking

GitHub-Issues in `dom8509/orca-workflow-status`, Regeln in `docs/agents/issue-tracker.md`.

## Definition of Done

Ein Issue ist fertig, wenn jedes Akzeptanzkriterium einzeln belegt ist, mit Kommando und
Ausgabe. Mindestens grün sein müssen:

```sh
orca plugin test . --json
orca plugin check . --json
orca plugin validate . --json
```

Neue oder geänderte Capabilities in `orca-plugin.json` brauchen eine erneute Freigabe in Orca;
die PR-Beschreibung nennt sie.

## Sprache

Deutsch: Issues, Commits, PR-Beschreibungen, Kommentare und Dokumente. Englisch: Code,
Bezeichner, Dateinamen und die Oberfläche des Plugins.
