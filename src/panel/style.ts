// Aussehen des Panels nach dem Entwurf "Autonomous pipeline": Activity-Liste, darunter eine
// vertikale Zeitleiste der Phasen. Nur `--orca-*`-Variablen (O12-2); Farbe entsteht durch Tönung
// mit `color-mix`, damit jedes Orca-Theme passt. Die Seite scrollt nicht; Liste und Pipeline
// scrollen je für sich unter festen Überschriften.
const tint = (variable: string, percent: number) => `color-mix(in srgb, var(${variable}) ${percent}%, transparent)`

export const PANEL_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; overflow: hidden; }
body {
  background: var(--orca-background);
  color: var(--orca-foreground);
  font: 13px/1.4 var(--orca-font-sans);
}
.panel {
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
h2 { margin: 0; font-size: 15px; font-weight: 600; }
.muted { color: var(--orca-muted-foreground); margin: 0; }
.callout {
  flex: none;
  border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius);
  padding: 8px 10px;
  background: var(--orca-card);
}
.callout.danger { border-color: var(--orca-destructive); color: var(--orca-destructive); background: ${tint('--orca-destructive', 8)}; }
.callout.warning { color: var(--orca-muted-foreground); }

/* Zwei Bereiche, die sich die Höhe teilen; jeder scrollt für sich. */
.activity, .detail { display: flex; flex-direction: column; min-height: 0; gap: 8px; }
.activity { flex: 0 1 auto; max-height: 45%; }
.detail { flex: 1 1 0; border-top: 1px solid var(--orca-border); padding-top: 10px; }
.section-head { flex: none; }
.scroll { overflow-y: auto; min-height: 0; overscroll-behavior: contain; padding-right: 2px; }
.detail .scroll { flex: 1 1 auto; }

.activity-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.count {
  font-size: 11px;
  font-weight: 500;
  color: var(--orca-primary);
  background: ${tint('--orca-primary', 14)};
  border-radius: 999px;
  padding: 1px 7px;
  vertical-align: 2px;
}
.filter { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--orca-muted-foreground); cursor: pointer; }
.filter input { accent-color: var(--orca-primary); margin: 0; }

.jobs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.jobs > .muted { padding: 6px 2px; }
.job {
  width: 100%;
  display: grid;
  gap: 3px;
  text-align: left;
  font: inherit;
  color: inherit;
  padding: 6px 10px;
  border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius);
  background: var(--orca-card);
  cursor: pointer;
}
.job:hover { background: ${tint('--orca-primary', 6)}; }
.job:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
.job.selected {
  border-color: var(--orca-primary);
  background: ${tint('--orca-primary', 10)};
  box-shadow: inset 3px 0 0 var(--orca-primary);
}
.job-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  font-size: 11px;
  font-weight: 500;
  color: var(--orca-primary);
  background: ${tint('--orca-primary', 14)};
  border: 1px solid ${tint('--orca-primary', 35)};
  border-radius: 999px;
  padding: 0 7px;
  overflow-wrap: anywhere;
}
.no-workflow { font-size: 12px; color: var(--orca-muted-foreground); }
.job-meta { font-size: 11px; color: var(--orca-muted-foreground); display: flex; gap: 6px; align-items: center; }
.ago { flex: none; }
.state {
  border-radius: 999px;
  padding: 0 7px;
  color: var(--orca-muted-foreground);
  background: ${tint('--orca-muted-foreground', 12)};
}
.state.working { color: var(--orca-primary); background: ${tint('--orca-primary', 16)}; }
.state.blocked, .state.waiting { color: var(--orca-destructive); background: ${tint('--orca-destructive', 14)}; }

.route { margin: 2px 0 0; color: var(--orca-muted-foreground); font-size: 12px; }
.timeline { list-style: none; margin: 0; padding: 0; position: relative; }
.stage { position: relative; padding: 0 0 8px 26px; }
.stage::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--orca-border);
}
.stage:first-child::before { top: 14px; }
.stage:last-child::before { bottom: calc(100% - 14px); }
.stage.done::before { background: ${tint('--orca-primary', 55)}; }
.dot {
  position: absolute;
  left: 1px;
  top: 8px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--orca-border);
  background: var(--orca-background);
}
.stage.done .dot { border-color: var(--orca-primary); background: ${tint('--orca-primary', 55)}; }
.stage.current .dot {
  border-color: var(--orca-primary);
  background: radial-gradient(circle, var(--orca-primary) 0 3px, var(--orca-background) 3.5px);
  box-shadow: 0 0 0 4px ${tint('--orca-primary', 18)};
}
.stage-card {
  border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius);
  background: var(--orca-card);
  padding: 7px 10px;
}
.stage.done > .stage-card { background: ${tint('--orca-primary', 5)}; }
.stage.current > .stage-card {
  border-color: var(--orca-primary);
  background: ${tint('--orca-primary', 12)};
  box-shadow: 0 0 0 1px ${tint('--orca-primary', 30)};
}
.stage.pending > .stage-card { color: var(--orca-muted-foreground); }
.stage-head { display: flex; align-items: center; gap: 6px; }
.stage-name { font-weight: 600; flex: 1; }
.stage.current .stage-name { color: var(--orca-primary); }
.stage-description { font-size: 12px; color: var(--orca-muted-foreground); margin-top: 2px; }
.check { width: 16px; height: 16px; color: var(--orca-primary); flex: none; }
.next {
  font-size: 11px;
  border: 1px dashed var(--orca-primary);
  color: var(--orca-primary);
  border-radius: 999px;
  padding: 0 6px;
}
.nested { margin: 8px 0 0 4px; padding-left: 8px; border-left: 2px dashed ${tint('--orca-primary', 40)}; }
.nested h2 { font-size: 13px; }
.nested .route { margin-bottom: 6px; }
`
