// Aussehen des Panels nach dem Entwurf "Autonomous pipeline": Activity-Liste, darunter eine
// vertikale Zeitleiste der Phasen. Nur `--orca-*`-Variablen, damit helles und dunkles Theme passen.
export const PANEL_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--orca-background);
  color: var(--orca-foreground);
  font: 13px/1.4 var(--orca-font-sans);
}
.panel { padding: 12px; display: flex; flex-direction: column; gap: 16px; }
h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
.muted { color: var(--orca-muted-foreground); margin: 0; }
.callout {
  border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius);
  padding: 8px 10px;
  background: var(--orca-card);
}
.callout.danger { border-color: var(--orca-destructive); color: var(--orca-destructive); }
.callout.warning { color: var(--orca-muted-foreground); }

.jobs {
  list-style: none;
  margin: 0;
  padding: 0 2px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 38vh;
  overflow-y: auto;
}
.job {
  width: 100%;
  display: grid;
  gap: 2px;
  text-align: left;
  font: inherit;
  color: inherit;
  padding: 6px 10px;
  border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius);
  background: var(--orca-card);
  cursor: pointer;
}
.job:hover { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.job:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
.job.selected { border-color: var(--orca-primary); box-shadow: inset 3px 0 0 var(--orca-primary); }
.job-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-meta { font-size: 11px; color: var(--orca-muted-foreground); display: flex; gap: 6px; align-items: center; min-width: 0; }
.job-summary { font-size: 12px; color: var(--orca-muted-foreground); overflow-wrap: anywhere; }
.job-summary.active { color: var(--orca-foreground); font-weight: 500; }
.ago { flex: none; }
.state {
  border: 1px solid var(--orca-border);
  border-radius: 999px;
  padding: 0 6px;
  color: var(--orca-foreground);
}
.state.working { border-color: var(--orca-primary); color: var(--orca-primary); }
.state.blocked, .state.waiting { border-color: var(--orca-destructive); color: var(--orca-destructive); }

.route { margin: -4px 0 10px; color: var(--orca-muted-foreground); font-size: 12px; }
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
.stage.done::before { background: var(--orca-muted-foreground); }
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
.stage.done .dot { border-color: var(--orca-muted-foreground); }
.stage.current .dot {
  border-color: var(--orca-primary);
  background: radial-gradient(circle, var(--orca-primary) 0 3px, var(--orca-background) 3.5px);
}
.stage-card {
  border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius);
  background: var(--orca-card);
  padding: 7px 10px;
}
.stage.current > .stage-card { border-color: var(--orca-primary); background: var(--orca-accent); }
.stage.pending > .stage-card { color: var(--orca-muted-foreground); }
.stage-head { display: flex; align-items: center; gap: 6px; }
.stage-name { font-weight: 600; flex: 1; }
.stage-description { font-size: 12px; color: var(--orca-muted-foreground); margin-top: 2px; }
.check { width: 16px; height: 16px; color: var(--orca-primary); flex: none; }
.next {
  font-size: 11px;
  border: 1px dashed var(--orca-primary);
  color: var(--orca-primary);
  border-radius: 999px;
  padding: 0 6px;
}
.nested { margin: 8px 0 0 4px; padding-left: 8px; border-left: 2px dashed var(--orca-border); }
.nested h2 { font-size: 13px; }
`
