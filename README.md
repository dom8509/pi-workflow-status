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
- Der Worker beobachtet den Sessions-Ordner und meldet geänderte Sessions nach 500 ms an das
  Panel (`jobs.changed`). Das Panel fragt außerdem bei jeder Statusänderung eines Agenten und bei
  jedem Workspace-Wechsel neu ab.

Anzeige in der Spalte Workflow: `no workflow` für Agenten ohne Pi-Session (zum Beispiel Claude
Code), `unknown` für Pi-Agenten ohne auffindbare Session, `—` für Pi-Agenten ohne aktiven Workflow.

Der Worker läuft als `trusted-worker` und hat damit die Dateirechte deines Benutzers. Er liest nur
Dateien unterhalb des Sessions-Ordners.

## Entwickeln

```sh
orca plugin test .       # Unit-Tests: Parser, Sessions, Worker, Panel
orca plugin check .      # zeichnet das Panel in den Szenarien aus src/panel.check.ts
orca plugin validate .
orca plugin dev watch .  # lädt den Ordner in Orca; Ctrl-C entlädt ihn
```

Den Sessions-Ordner stellt man in Orca unter Settings → Plugins → Workflow Status ein.
