// Liest den Workflow-Zustand eines Pi-Agenten aus seiner Session-Datei (JSONL).
//
// Pi-Agent-Suite schreibt dafür Einträge `{ type: 'custom', customType: 'workflow-state', data }`:
//   activated    — `data.workflow` (Definition), `data.route` (Phasenfolge), `data.mode`
//                  ('replace' ersetzt den Stapel, 'push' legt einen verschachtelten Workflow auf)
//   transitioned — `data.route` ist die neue Phasenfolge des obersten Workflows
//   exited       — nimmt den obersten Workflow ab
// Ein Übergang mit Prüf-Workflow (`workflow_transition` mit Attribut `workflow`) schreibt
// `activated` mit `mode: 'push'` und `pendingTransition.stageId`: der darunterliegende Workflow
// wartet und rückt erst bei `exited` mit `allow: true` in diese Phase vor.
// Eine Session ist ein Baum (`id`/`parentId`); es zählt nur die Kette vom letzten Eintrag
// zur Wurzel, also der Zweig, auf dem die Session gerade steht.

export type WorkflowLevel = {
  workflow: string
  stage: string
  /** 1-basierte Position der Phase in der Definition, null wenn unbekannt. */
  stageNumber: number | null
  stageCount: number | null
  /** Phase, in die dieser Workflow wechselt, sobald der darüberliegende Prüf-Workflow sie freigibt. */
  pendingStage?: string
}

type Entry = { id: string; parentId: string | null; data?: Record<string, unknown> }

type Frame = {
  workflow: string
  stages: string[] | null
  route: string[]
  /** Ziel des Übergangs, auf dessen Freigabe der darunterliegende Workflow wartet. */
  releases?: string
}

function parseLines(text: string): Entry[] {
  const entries: Entry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (!value || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    if (typeof record.id !== 'string' || record.type === 'session') continue
    const entry: Entry = {
      id: record.id,
      parentId: typeof record.parentId === 'string' ? record.parentId : null
    }
    if (
      record.type === 'custom' &&
      record.customType === 'workflow-state' &&
      record.data &&
      typeof record.data === 'object'
    ) {
      entry.data = record.data as Record<string, unknown>
    }
    entries.push(entry)
  }
  return entries
}

/** Einträge des aktuellen Zweigs, von der Wurzel zum letzten Eintrag. */
function currentBranch(entries: Entry[]): Entry[] {
  if (entries.length === 0) return []
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const branch: Entry[] = []
  const seen = new Set<string>()
  let cursor: Entry | undefined = entries[entries.length - 1]
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    branch.push(cursor)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return branch.reverse()
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null
}

function frameOf(data: Record<string, unknown>): Frame | null {
  const workflow = data.workflow as Record<string, unknown> | undefined
  const route = stringArray(data.route)
  if (!workflow || typeof workflow.id !== 'string' || !route) return null
  const stages = Array.isArray(workflow.stages)
    ? workflow.stages
        .map((stage) => (stage && typeof stage === 'object' ? (stage as { id?: unknown }).id : null))
        .filter((id): id is string => typeof id === 'string')
    : null
  const pending = data.pendingTransition as { stageId?: unknown } | undefined
  const releases = typeof pending?.stageId === 'string' ? pending.stageId : undefined
  return { workflow: workflow.id, stages, route, ...(releases ? { releases } : {}) }
}

export function parseWorkflowStack(text: string): WorkflowLevel[] {
  let stack: Frame[] = []
  for (const entry of currentBranch(parseLines(text))) {
    const data = entry.data
    if (!data) continue
    if (data.kind === 'activated') {
      const frame = frameOf(data)
      if (!frame) continue
      stack = data.mode === 'push' ? [...stack, frame] : [{ ...frame, releases: undefined }]
    } else if (data.kind === 'transitioned') {
      const route = stringArray(data.route)
      const top = stack[stack.length - 1]
      if (route && top) stack = [...stack.slice(0, -1), { ...top, route }]
    } else if (data.kind === 'exited') {
      const top = stack[stack.length - 1]
      stack = stack.slice(0, -1)
      const parent = stack[stack.length - 1]
      if (top?.releases && parent && data.allow === true) {
        stack = [...stack.slice(0, -1), { ...parent, route: [...parent.route, top.releases] }]
      }
    }
  }
  return stack
    .map((frame, position) => ({ frame, pending: stack[position + 1]?.releases }))
    .filter(({ frame }) => frame.route.length > 0)
    .map(({ frame, pending }) => {
      const stage = frame.route[frame.route.length - 1]
      const index = frame.stages ? frame.stages.indexOf(stage) : -1
      const level: WorkflowLevel = {
        workflow: frame.workflow,
        stage,
        stageNumber: index >= 0 ? index + 1 : null,
        stageCount: frame.stages && index >= 0 ? frame.stages.length : null
      }
      if (pending) level.pendingStage = pending
      return level
    })
}
