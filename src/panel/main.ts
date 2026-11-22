// HTML panel: connects Orca to the view model in ../view. Orca generates the page around this
// script; styles live in ./style.
import '../protocol'
import type { JobsSnapshot } from '../protocol'
import { FilterStore } from '../filter-store'
import { renderPanel } from '../view'
import { PANEL_CSS } from './style'

/** Refresh interval while the panel is visible; keeps the worker and its watcher alive. */
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
/** "Workflows only" filter: on by default, the choice lives in plugin storage (`storage:own`). */
const FILTER_KEY = 'workflowsOnly'
const filter = new FilterStore(
  true,
  (value) => orca.storage.set(FILTER_KEY, value),
  () => draw()
)
let sequence = 0

let lastHtml = ''

/**
 * Redraws while keeping keyboard focus and scroll positions, because every update replaces the
 * nodes. Unchanged content is not redrawn at all.
 */
function draw(): void {
  const html = renderPanel({ snapshot, selected, error: error ?? filter.error, now: Date.now(), workflowsOnly: filter.shown })
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
  // Remember which job is actually shown.
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
  if (input.dataset.filter === 'workflows-only') filter.choose(input.checked)
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

// Refresh as soon as the panel becomes visible again: the worker may have stopped meanwhile.
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
    if (typeof stored === 'boolean') filter.loaded(stored)
  } catch {
    // Without storage the default applies.
  }
}

draw()
void loadFilter().then(refresh)
