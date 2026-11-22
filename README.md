# Workflow Status

Ein Orca-Plugin, das in der rechten Sidebar für jeden Agenten aller lokalen Workspaces anzeigt,
in welchem Pi-Workflow und in welcher Phase er steht. Oben steht die Liste „Activity“ mit allen
Jobs, laufende zuerst; jeder Job mit Workflow trägt je Ebene einen Chip wie `Coding · implement`.
Der Schalter „Workflows only“ (Vorgabe an, gespeichert über `storage:own`) blendet Jobs ohne
aktiven Workflow aus. Liste und Pipeline scrollen getrennt; darunter die Pipeline des ausgewählten Jobs als Zeitleiste mit erledigten,
aktueller und offenen Phasen samt ihrer Beschreibung. Ein Prüf-Workflow wie ResultCheck erscheint
eingerückt unter der aktuellen Phase.

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
  übernimmt einen Tab-Titel nur, wenn im Workspace genau ein Agent dieser Art läuft. `jobs.list`
  wartet auf Titel höchstens 300 ms; später eintreffende meldet der Worker per `jobs.changed`.
  Sonst steht die Agent-Art als Name da.
- `src/view.ts` baut daraus Liste und Pipeline als HTML; `src/panel/main.ts` ist das HTML-Panel,
  `src/panel/style.ts` sein CSS: Flächen und Text aus den `--orca-*`-Variablen, Bedeutung aus
  einer eigenen Palette mit heller und dunkler Variante (grün erledigt, blau aktuell, bernstein
  wartet) und einem festen Farbton je Workflow (Coding blau, Package violett, ResultCheck türkis).
- Der Worker beobachtet den Sessions-Ordner und meldet geänderte Sessions nach 500 ms an das
  Panel (`jobs.changed`). Das Panel fragt außerdem bei jeder Statusänderung eines Agenten, bei
  jedem Workspace-Wechsel, sofort beim Sichtbarwerden und, solange es sichtbar ist, alle 15 s neu
  ab; das hält den Worker und damit den Watcher am Leben. Fehlt der Sessions-Ordner oder fällt der
  Watcher aus, legt der Worker ihn jede Sekunde neu an und meldet danach `jobs.changed`.

Anzeige in der Spalte Workflow: `no workflow` für Agenten ohne Pi-Session (zum Beispiel Claude
Code), `unknown` für Pi-Agenten ohne auffindbare Session, `—` für Pi-Agenten ohne aktiven Workflow.

Der Worker läuft als `trusted-worker` und hat damit die Dateirechte deines Benutzers. Er liest nur
Dateien, die nach Auflösen symbolischer Links unterhalb des Sessions-Ordners liegen.

Die eigene Palette weicht bewusst von Orcas Empfehlung ab, Panels nur mit Theme-Variablen zu
gestalten (Nutzerentscheidung O12-1); ein stark abweichendes Orca-Theme kann damit beißen.

Die Plugin-ID ist `pi-workflow-status`, weil Orca IDs mit `orca-` seinem offiziellen Katalog
vorbehält. Das Panel gibt es nur in der Desktop-App von Orca.

## Entwickeln

```sh
orca plugin test .       # Unit-Tests: Parser, Sessions, Worker, Ansichtsmodell
orca plugin shot local.pi-workflow-status   # Screenshot des geladenen Panels
orca plugin validate .
orca plugin dev watch .  # lädt den Ordner in Orca; Ctrl-C entlädt ihn
```

Den Sessions-Ordner stellt man in Orca unter Settings → Plugins → Workflow Status ein.
