// Ansichtsmodell und HTML des Panels, ohne DOM: dieselben Funktionen laufen im Panel und im Test.
import type { WorkflowLevel } from './parse'
import type { AgentState, Job, JobsSnapshot, JobWorkflow } from './protocol'

export type ActivityItem = {
  key: string
  title: string
  workspace: string
  state: AgentState
  stateStartedAt: number
  /** Kurzform für die Liste, zum Beispiel `Coding · plan › ResultCheck · check`. */
  summary: string
  job: Job
}

export type StageStatus = 'done' | 'current' | 'pending'

export type Pipeline = {
  workflow: string
  stages: { id: string; description: string | null; status: StageStatus; next: boolean }[]
  /** Workflow, der über der aktuellen Phase läuft, zum Beispiel ResultCheck. */
  nested: Pipeline | null
}

const ACTIVE: Record<AgentState, number> = { working: 0, blocked: 0, waiting: 0, done: 1 }

export function summaryOf(workflow: JobWorkflow): string {
  if (workflow === 'none') return 'no workflow'
  if (workflow === 'unknown') return 'workflow unknown'
  if (workflow.length === 0) return 'no active workflow'
  return workflow.map((level) => `${level.workflow} · ${level.stage}`).join(' › ')
}

/** Alle Jobs, laufende zuerst, innerhalb dessen die zuletzt geänderten zuerst. */
export function activityOf(snapshot: JobsSnapshot): ActivityItem[] {
  return snapshot.groups
    .flatMap((group) =>
      group.jobs.map((job) => ({
        key: job.key,
        title: job.title,
        workspace: group.name,
        state: job.state,
        stateStartedAt: job.stateStartedAt,
        summary: summaryOf(job.workflow),
        job
      }))
    )
    .sort((a, b) => ACTIVE[a.state] - ACTIVE[b.state] || b.stateStartedAt - a.stateStartedAt)
}

function hasActiveWorkflow(item: ActivityItem): boolean {
  return Array.isArray(item.job.workflow) && item.job.workflow.length > 0
}

/** Mit Filter nur Jobs, die gerade einen Workflow ausführen. */
export function visibleItems(items: ActivityItem[], workflowsOnly: boolean): ActivityItem[] {
  return workflowsOnly ? items.filter(hasActiveWorkflow) : items
}

/** Die bisherige Auswahl, solange es den Job gibt; sonst der erste Job mit aktivem Workflow. */
export function selectJob(items: ActivityItem[], current: string | null): string | null {
  if (current && items.some((item) => item.key === current)) return current
  return (items.find(hasActiveWorkflow) ?? items[0])?.key ?? null
}

/**
 * Pipeline eines Workflow-Stapels. Eine Phase gilt als erledigt, wenn sie in der Definition vor der
 * aktuellen steht; nach einem Rücksprung (zum Beispiel von `verify` zurück nach `implement`) gelten
 * die späteren Phasen wieder als offen.
 */
export function pipelineOf(workflow: JobWorkflow): Pipeline | null {
  if (!Array.isArray(workflow) || workflow.length === 0) return null
  return levelPipeline(workflow, 0)
}

function levelPipeline(levels: WorkflowLevel[], depth: number): Pipeline {
  const level = levels[depth]
  // Eine Phase, die die Definition nicht kennt, hängt als aktuelle Phase hinten an, damit sie und
  // ein darüberliegender Prüf-Workflow sichtbar bleiben.
  const known = level.stages.some((stage) => stage.id === level.stage)
  const stages = known ? level.stages : [...level.stages, { id: level.stage, description: null }]
  const current = stages.findIndex((stage) => stage.id === level.stage)
  return {
    workflow: level.workflow,
    stages: stages.map((stage, index) => ({
      id: stage.id,
      description: stage.description,
      // Bei unbekannter Phase ist offen, was davor erledigt ist; die Definition bleibt dann offen.
      status: index === current ? 'current' : known && index < current ? 'done' : 'pending',
      next: stage.id === level.pendingStage
    })),
    nested: depth + 1 < levels.length ? levelPipeline(levels, depth + 1) : null
  }
}

/** Farbtöne der bekannten Workflows; Coding blau, Package violett, ResultCheck türkis. */
const KNOWN_HUES: Record<string, number> = {
  Coding: 215,
  Package: 270,
  ResultCheck: 175,
  Research: 30,
  Analysis: 330,
  Extraction: 95
}

/** Fester Farbton (0–359) eines Workflows; unbekannte Namen bekommen einen aus ihrem Namen. */
export function workflowHue(name: string): number {
  const known = KNOWN_HUES[name]
  if (known !== undefined) return known
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return hash % 360
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000]
]

/** "3m ago"; genauer als eine Minute muss die Liste nicht sein. */
export function ago(at: number, now: number): string {
  const diff = Math.max(0, now - at)
  if (diff < 60_000) return 'just now'
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) {
      const value = Math.floor(diff / ms)
      const short = unit === 'day' ? 'd' : unit === 'hour' ? 'h' : unit === 'minute' ? 'm' : 's'
      return `${value}${short} ago`
    }
  }
  return 'just now'
}

const CHECK =
  '<svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function renderTimeline(pipeline: Pipeline): string {
  const stages = pipeline.stages
    .map((stage) => {
      const description = stage.description ? `<div class="stage-description">${escapeHtml(stage.description)}</div>` : ''
      const next = stage.next ? '<span class="next">next</span>' : ''
      const mark = stage.status === 'done' ? CHECK : ''
      const nested =
        stage.status === 'current' && pipeline.nested
          ? `<div class="nested">${renderPipeline(pipeline.nested)}</div>`
          : ''
      return `<li class="stage ${stage.status}" aria-current="${stage.status === 'current' ? 'step' : 'false'}">
  <span class="dot" aria-hidden="true"></span>
  <div class="stage-card"><div class="stage-head"><span class="stage-name">${escapeHtml(stage.id)}</span>${next}${mark}</div>${description}</div>
  ${nested}
</li>`
    })
    .join('')
  return `<ol class="timeline">${stages}</ol>`
}

/** Verschachtelte Pipeline: Überschrift und Zeitleiste gemeinsam. */
function renderPipeline(pipeline: Pipeline): string {
  return `<div class="pipeline">${pipelineHeader(pipeline)}${renderTimeline(pipeline)}</div>`
}

function pipelineHeader(pipeline: Pipeline): string {
  return `<h2 style="--hue: ${workflowHue(pipeline.workflow)}"><span class="hue-dot"></span>${escapeHtml(pipeline.workflow)}</h2>
<p class="route">${pipeline.stages.map((stage) => escapeHtml(stage.id)).join(' → ')}</p>`
}

/** Die oberste Pipeline: Überschrift fest, Zeitleiste im eigenen Scrollbereich. */
function renderDetail(pipeline: Pipeline): string {
  return `<section class="detail">
<header class="section-head">${pipelineHeader(pipeline)}</header>
<div class="scroll">${renderTimeline(pipeline)}</div>
</section>`
}

function chipsOf(item: ActivityItem): string {
  const workflow = item.job.workflow
  if (!Array.isArray(workflow) || workflow.length === 0) {
    return `<span class="no-workflow">${escapeHtml(item.summary)}</span>`
  }
  return `<span class="chips">${workflow
    .map(
      (level) =>
        `<span class="chip" style="--hue: ${workflowHue(level.workflow)}">${escapeHtml(level.workflow)} · ${escapeHtml(level.stage)}</span>`
    )
    .join('')}</span>`
}

export type PanelModel = {
  snapshot: JobsSnapshot | null
  selected: string | null
  error: string | null
  now: number
  /** Nur Jobs zeigen, die einen Workflow ausführen. */
  workflowsOnly: boolean
}

export function renderPanel(model: PanelModel): string {
  const error = model.error ? `<div class="callout danger" role="alert">${escapeHtml(model.error)}</div>` : ''
  if (!model.snapshot) {
    return `${error}${model.error ? '' : '<p class="muted">Loading agents…</p>'}`
  }
  const items = activityOf(model.snapshot)
  const failures = model.snapshot.groups
    .filter((group) => group.error)
    .map((group) => `<div class="callout warning">${escapeHtml(group.name)}: ${escapeHtml(group.error ?? '')}</div>`)
    .join('')
  const visible = visibleItems(items, model.workflowsOnly)
  const selected = selectJob(visible, model.selected)
  const list = visible
    .map(
      (item) => `<li><button type="button" class="job${item.key === selected ? ' selected' : ''}" data-key="${escapeHtml(item.key)}" aria-pressed="${item.key === selected}" title="${escapeHtml(item.workspace)}">
  <span class="job-title">${escapeHtml(item.title)}</span>
  ${chipsOf(item)}
  <span class="job-meta"><span class="state ${item.state}">${item.state}</span><span class="ago">${ago(item.stateStartedAt, model.now)}</span></span>
</button></li>`
    )
    .join('')
  const empty =
    items.length === 0
      ? '<li class="muted">No agents. No workspace on this computer has a running agent.</li>'
      : visible.length === 0
        ? '<li class="muted">No job is running a workflow right now.</li>'
        : ''
  const header = `<header class="section-head activity-head">
  <h2>Activity <span class="count">${visible.length}/${items.length}</span></h2>
  <label class="filter"><input type="checkbox" data-filter="workflows-only"${model.workflowsOnly ? ' checked' : ''}> Workflows only</label>
</header>`
  const chosen = visible.find((item) => item.key === selected)
  const pipeline = chosen ? pipelineOf(chosen.job.workflow) : null
  const detail = !chosen
    ? ''
    : pipeline
      ? renderDetail(pipeline)
      : `<section class="detail"><p class="muted">${escapeHtml(chosen.title)} has no Pi workflow right now (${escapeHtml(chosen.summary)}).</p></section>`
  return `${error}${failures}
<section class="activity">
${header}
<ul class="jobs scroll">${list}${empty}</ul>
</section>
${detail}`
}
