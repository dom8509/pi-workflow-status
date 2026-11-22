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
/** Filter „Workflows only“; Vorgabe an, die Wahl liegt im Plugin-Speicher (`storage:own`). */
let workflowsOnly = true
const FILTER_KEY = 'workflowsOnly'
const SAVE_ERROR = 'Could not save the filter'
let sequence = 0

let lastHtml = ''

/**
 * Zeichnet neu und erhält dabei Tastaturfokus und Scrollposition der Liste, denn jede
 * Aktualisierung ersetzt die Knoten. Unveränderter Inhalt wird gar nicht neu gezeichnet.
 */
function draw(): void {
  const html = renderPanel({ snapshot, selected, error, now: Date.now(), workflowsOnly })
  if (html !== lastHtml) {
    const active = document.activeElement as HTMLElement | null
    const focusedKey = active?.closest?.<HTMLElement>('button.job')?.dataset.key
    const filterFocused = active?.matches?.('[data-filter]') ?? false
    const listScroll = root.querySelector('.jobs')?.scrollTop ?? 0
    const detailScroll = root.querySelector('.detail .scroll')?.scrollTop ?? 0
    root.innerHTML = html
    lastHtml = html
    const list = root.querySelector('.jobs')
    if (list) list.scrollTop = listScroll
    const detail = root.querySelector('.detail .scroll')
    if (detail) detail.scrollTop = detailScroll
    if (focusedKey) {
      for (const button of root.querySelectorAll<HTMLElement>('button.job')) {
        if (button.dataset.key === focusedKey) button.focus({ preventScroll: true })
      }
    } else if (filterFocused) {
      root.querySelector<HTMLElement>('[data-filter]')?.focus({ preventScroll: true })
    }
  }
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

root.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement
  if (input.dataset.filter !== 'workflows-only') return
  const previous = workflowsOnly
  workflowsOnly = input.checked
  draw()
  // Schlägt das Speichern fehl, gilt wieder die gespeicherte Wahl, und das Panel sagt warum.
  orca.storage.set(FILTER_KEY, workflowsOnly).then(
    () => {
      if (error?.startsWith(SAVE_ERROR)) {
        error = null
        draw()
      }
    },
    (cause: unknown) => {
      workflowsOnly = previous
      error = `${SAVE_ERROR}: ${cause instanceof Error ? cause.message : String(cause)}`
      draw()
    }
  )
})

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

async function loadFilter(): Promise<void> {
  try {
    const stored = await orca.storage.get(FILTER_KEY)
    if (typeof stored === 'boolean') workflowsOnly = stored
  } catch {
    // Ohne Speicher gilt die Vorgabe.
  }
}

draw()
void loadFilter().then(refresh)
