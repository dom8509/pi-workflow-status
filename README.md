# Workflow Status

Ein Orca-Plugin, das in der rechten Sidebar für jeden Agenten aller lokalen Workspaces anzeigt,
in welchem Pi-Workflow und in welcher Phase er steht, zum Beispiel
`Coding › plan (3/6, next: implement) ⟶ ResultCheck › check (1/2)`.

## Wie es funktioniert

- `src/worker.ts` fragt Orca nach allen Workspaces (`workspace.list`) und deren Agenten
  (`agents.list`). Zu jedem Pi-Agenten sucht es die Session-Datei unter dem Sessions-Ordner,
  standardmäßig `~/.pi/agent/sessions`, über die `sessionId`, die Orca liefert. Findet es keine,
  nimmt es die neueste Session im Ordner des Workspace-Pfads, aber nur, wenn dort genau ein
  Pi-Agent läuft.
- `src/parse.ts` liest aus der Session die Einträge `customType: "workflow-state"` (`activated`,
  `transitioned`, `exited`) entlang des aktuellen Zweigs und baut daraus den Workflow-Stapel.
- Jobnamen kommen exakt über die `sessionId` aus Orcas Session-Historie (`agent.listSessions`,
  Recht `history:read`). Fehlt dort ein Treffer, fragt der Worker `orca agent list --json` und
  übernimmt einen Tab-Titel nur, wenn im Workspace genau ein Agent dieser Art läuft; er wartet
  darauf höchstens 1,5 s. Sonst steht die Agent-Art als Name da.
- Der Worker beobachtet den Sessions-Ordner und meldet geänderte Sessions nach 500 ms an das
  Panel (`jobs.changed`). Das Panel fragt außerdem bei jeder Statusänderung eines Agenten, bei
  jedem Workspace-Wechsel und, solange es sichtbar ist, alle 15 s neu ab; das hält den Worker und
  damit den Watcher am Leben.

Anzeige in der Spalte Workflow: `no workflow` für Agenten ohne Pi-Session (zum Beispiel Claude
Code), `unknown` für Pi-Agenten ohne auffindbare Session, `—` für Pi-Agenten ohne aktiven Workflow.

Der Worker läuft als `trusted-worker` und hat damit die Dateirechte deines Benutzers. Er liest nur
Dateien, die nach Auflösen symbolischer Links unterhalb des Sessions-Ordners liegen.

Die Plugin-ID ist `pi-workflow-status`, weil Orca IDs mit `orca-` seinem offiziellen Katalog
vorbehält. Das Panel gibt es nur in der Desktop-App von Orca.

## Entwickeln

```sh
orca plugin test .       # Unit-Tests: Parser, Sessions, Worker, Panel
orca plugin check .      # zeichnet das Panel in den Szenarien aus src/panel.check.ts
orca plugin validate .
orca plugin dev watch .  # lädt den Ordner in Orca; Ctrl-C entlädt ihn
```

Den Sessions-Ordner stellt man in Orca unter Settings → Plugins → Workflow Status ein.
