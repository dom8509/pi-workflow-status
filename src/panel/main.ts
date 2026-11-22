// HTML-Panel: verbindet Orca mit dem Ansichtsmodell aus ../view. Orca erzeugt die Seite um dieses
// Skript; Farben und Schriften kommen ausschließlich aus den `--orca-*`-Variablen des Themes.
import '../protocol'
import type { JobsSnapshot } from '../protocol'
import { renderPanel } from '../view'
import { PANEL_CSS } from './style'

/** Abstand der Nachfrage, solange das Panel sichtbar ist; hält den Worker und seinen Watcher wach. */
const KEEP_ALIVE_MS = 15_000

const style = document.createElement('style')
style.textContent = PANEL_CSS
document.head.appendChild(style)

const root = document.createElement('main')
root.className = 'panel'
document.body.appendChild(root)

let snapshot: JobsSnapshot | null = null
let error: string | null = null
let selected: string | null = null
let sequence = 0

function draw(): void {
  root.innerHTML = renderPanel({ snapshot, selected, error, now: Date.now() })
  // Die Auswahl merkt sich, welcher Job tatsächlich gezeigt wird.
  selected = root.querySelector<HTMLElement>('.job.selected')?.dataset.key ?? selected
}

async function refresh(): Promise<void> {
  const mine = ++sequence
  try {
    const answer = await orca.plugin.request('jobs.list')
    if (mine !== sequence) return
    snapshot = answer
    error = null
  } catch (cause) {
    if (mine !== sequence) return
    error = cause instanceof Error ? cause.message : String(cause)
  }
  draw()
}

root.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('button.job')
  if (!button?.dataset.key) return
  selected = button.dataset.key
  draw()
})

orca.plugin.on('jobs.changed', () => void refresh())
orca.on('agent.status.changed', () => void refresh())
orca.on('workspace.changed', () => void refresh())

// Wird das Panel wieder sichtbar, sofort nachfragen: der Worker kann inzwischen beendet sein.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh()
})

const keepAlive = (): void => {
  setTimeout(() => {
    if (!document.hidden) void refresh()
    keepAlive()
  }, KEEP_ALIVE_MS)
}
keepAlive()

draw()
void refresh()
