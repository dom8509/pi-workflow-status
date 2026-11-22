// Reads a Pi agent's workflow state from its session file (JSONL).
//
// Pi Agent Suite writes entries `{ type: 'custom', customType: 'workflow-state', data }`:
//   activated    — `data.workflow` (definition), `data.route` (stage sequence), `data.mode`
//                  ('replace' replaces the stack, 'push' adds a nested workflow)
//   transitioned — `data.route` is the new stage sequence of the top workflow
//   exited       — removes the top workflow
// A transition through a check workflow (`workflow_transition` with a `workflow` attribute)
// writes `activated` with `mode: 'push'` and `pendingTransition.stageId`: the workflow below waits
// and moves to that stage only on `exited` with `allow: true`.
// A session is a tree (`id`/`parentId`); only the chain from the last entry to the root counts,
// that is the branch the session is currently on.

export type WorkflowLevel = {
  workflow: string
  stage: string
  /** 1-based position of the stage in the definition, null when unknown. */
  stageNumber: number | null
  stageCount: number | null
  /** Stage this workflow moves to once the check workflow above allows it. */
  pendingStage?: string
  /** Stages of the definition in order; empty when the definition lists none. */
  stages: StageInfo[]
}

export type StageInfo = { id: string; description: string | null }

type Entry = { id: string; parentId: string | null; data?: Record<string, unknown> }

type Frame = {
  workflow: string
  stages: StageInfo[] | null
  route: string[]
  /** Target of the transition the workflow below is waiting to have allowed. */
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

/** Entries of the current branch, from the root to the last entry. */
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
    ? workflow.stages.flatMap((stage): StageInfo[] => {
        const record = stage && typeof stage === 'object' ? (stage as { id?: unknown; description?: unknown }) : null
        if (!record || typeof record.id !== 'string') return []
        return [{ id: record.id, description: typeof record.description === 'string' ? record.description : null }]
      })
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
      const index = frame.stages ? frame.stages.findIndex((info) => info.id === stage) : -1
      const level: WorkflowLevel = {
        workflow: frame.workflow,
        stage,
        stageNumber: index >= 0 ? index + 1 : null,
        stageCount: frame.stages && index >= 0 ? frame.stages.length : null,
        stages: frame.stages ?? []
      }
      if (pending) level.pendingStage = pending
      return level
    })
}
