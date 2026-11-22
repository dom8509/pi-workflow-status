// The plugin's worker: collects the agents of all local workspaces, reads each Pi agent's workflow
// state from its session file and reports changed session files to the panel.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentState, Job, JobGroup, JobsSnapshot, JobWorkflow } from './protocol'
import { DEFAULT_SESSIONS_DIR, SessionIndex, expandHome, readWorkflowStack, watchSessions } from './sessions'
import { cliAgents, inWorkspace, uniqueCliTitle, type CliAgent } from './titles'

/** Delay over which several writes are batched into one notification. */
const CHANGE_DELAY_MS = 500

type AgentRow = {
  terminalId: string | null
  title: string | null
  agent: string | null
  state: AgentState
  stateStartedAt: number
  sessionId?: string | null
}

type WorkspaceRow = { id: string; name: string; path: string; hostId: string | null }

async function sessionsDir(orca: OrcaWorkerApi): Promise<string> {
  const value = await orca.settings.get('sessionsDir')
  return expandHome(typeof value === 'string' && value.trim() ? value : DEFAULT_SESSIONS_DIR)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function workflowOf(path: string | null): JobWorkflow {
  if (!path) return 'unknown'
  return readWorkflowStack(path) ?? 'unknown'
}

/** Titles from Orca's session history for this workspace, by `sessionId`. */
async function historyTitles(orca: OrcaWorkerApi, workspace: WorkspaceRow, agents: AgentRow[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  if (!agents.some((agent) => agent.sessionId)) return titles
  try {
    const { sessions } = await orca.host.call('agent.listSessions', { workspaceId: workspace.id, limit: 200 })
    for (const entry of sessions) if (entry.title.trim()) titles.set(entry.sessionId, entry.title)
  } catch {
    // Without history the CLI fallback remains.
  }
  return titles
}

/**
 * Keys under which the history may name a session. For Pi, `agents.list` returns the path of the
 * session file and the history the Pi session id from the file name
 * (`…/2026-11-22T16-36-23-971Z_01a2041d-….jsonl` → `01a2041d-…`).
 */
function historyKeys(sessionId: string | null | undefined): string[] {
  if (!sessionId) return []
  const name = sessionId.slice(sessionId.lastIndexOf('/') + 1)
  if (!name.endsWith('.jsonl') || !name.includes('_')) return [sessionId]
  return [sessionId, name.slice(name.lastIndexOf('_') + 1, -'.jsonl'.length)]
}

function historyTitle(agent: AgentRow, history: Map<string, string>): string | undefined {
  for (const key of historyKeys(agent.sessionId)) {
    const title = history.get(key)
    if (title) return title
  }
  return undefined
}

/** Stable key of a job, also without a terminal: its sessionId, otherwise its position. */
function keyOf(workspace: WorkspaceRow, agent: AgentRow, position: number): string {
  return agent.terminalId ?? `${workspace.id}#${agent.sessionId ?? position}`
}

function jobsOf(workspace: WorkspaceRow, agents: AgentRow[], index: SessionIndex, titles: Map<string, string>): Job[] {
  const paths = agents.map((agent) => (agent.agent === 'pi' ? index.find(agent.sessionId) : null))
  const pi = agents.filter((agent) => agent.agent === 'pi')
  // Without a matching sessionId, use the workspace's newest session only when it can belong to
  // exactly one Pi agent.
  const fallback = pi.length === 1 ? index.newestFor(workspace.path) : null
  return agents.map((agent, position) => {
    const key = keyOf(workspace, agent, position)
    return {
      key,
      title: agent.title ?? titles.get(key) ?? agent.agent ?? 'Agent',
      agent: agent.agent,
      state: agent.state,
      stateStartedAt: agent.stateStartedAt,
      workflow: agent.agent === 'pi' ? workflowOf(paths[position] ?? fallback) : 'none'
    }
  })
}

type Fetched = { workspace: WorkspaceRow; agents: AgentRow[] } | { workspace: WorkspaceRow; error: string }

/** Titles for all jobs without their own title: history exactly, CLI only when unambiguous. */
async function resolveTitles(orca: OrcaWorkerApi, fetched: Fetched[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  let cli: Promise<CliAgent[]> | null = null
  await Promise.all(
    fetched.map(async (entry) => {
      if (!('agents' in entry)) return
      const { workspace, agents } = entry
      const history = await historyTitles(orca, workspace, agents)
      const needsCli = agents.some((agent) => !agent.title && !historyTitle(agent, history))
      if (needsCli && cli === null) cli = cliAgents()
      const local = needsCli ? (await (cli ?? Promise.resolve([]))).filter((agent) => inWorkspace(agent, workspace)) : []
      agents.forEach((agent, position) => {
        if (agent.title) return
        const exact = historyTitle(agent, history)
        const sameKind = agents.filter((other) => other.agent === agent.agent).length
        const title = exact ?? (sameKind === 1 ? uniqueCliTitle(local, agent.agent) : null)
        if (title) titles.set(keyOf(workspace, agent, position), title)
      })
    })
  )
  return titles
}

/** How long `jobs.list` waits for titles; later ones follow with `jobs.changed`. */
const TITLE_BUDGET_MS = 300

function sameTitles(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [key, title] of a) if (b.get(key) !== title) return false
  return true
}

/** Last known titles across requests; a new worker starts empty. */
export type TitleStore = { titles: Map<string, string>; onLate: () => void }

export async function listJobs(orca: OrcaWorkerApi, store: TitleStore): Promise<JobsSnapshot> {
  const dir = await sessionsDir(orca)
  const index = new SessionIndex(dir)
  const { workspaces } = (await orca.host.call('workspace.list', {})) as { workspaces: WorkspaceRow[] }
  const fetched: Fetched[] = await Promise.all(
    workspaces
      // This computer only: sessions of other hosts are not in the local sessions folder.
      .filter((workspace) => workspace.hostId === null || workspace.hostId === 'local')
      .map(async (workspace): Promise<Fetched> => {
        try {
          const { agents } = (await orca.host.call('agents.list', { workspaceId: workspace.id })) as {
            agents: AgentRow[]
          }
          return { workspace, agents }
        } catch (error) {
          return { workspace, error: errorMessage(error) }
        }
      })
  )

  const work = resolveTitles(orca, fetched)
  let timer: ReturnType<typeof setTimeout> | undefined
  const intime = await Promise.race([
    work,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TITLE_BUDGET_MS)
    })
  ])
  clearTimeout(timer)
  if (intime) {
    store.titles = intime
  } else {
    void work.then((late) => {
      if (sameTitles(late, store.titles)) return
      store.titles = late
      store.onLate()
    })
  }

  const groups: JobGroup[] = []
  for (const entry of fetched) {
    if (!('agents' in entry)) {
      groups.push({ workspaceId: entry.workspace.id, name: entry.workspace.name, jobs: [], error: entry.error })
    } else if (entry.agents.length > 0) {
      groups.push({
        workspaceId: entry.workspace.id,
        name: entry.workspace.name,
        jobs: jobsOf(entry.workspace, entry.agents, index, store.titles)
      })
    }
  }
  return { groups, sessionsDir: dir }
}

/** Interval in which the worker recreates a missing or failed watcher. */
const RETRY_MS = 1000

let dispose: (() => void) | null = null

export default function activate(orca: OrcaWorkerApi): void {
  let stopWatching: (() => void) | null = null
  let watchedDir: string | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  /** There was a time without a watcher; the new watcher reports sessions from that gap at once. */
  let gap = false
  const changed = () => orca.panels.post('jobs.changed', { at: Date.now() })
  const store: TitleStore = { titles: new Map(), onLate: changed }

  function scheduleRetry(): void {
    if (retry) return
    retry = setTimeout(() => {
      retry = null
      void ensureWatching()
    }, RETRY_MS)
  }

  async function ensureWatching(): Promise<void> {
    const dir = await sessionsDir(orca)
    if (dir === watchedDir && stopWatching) return
    stopWatching?.()
    watchedDir = dir
    stopWatching = watchSessions(dir, changed, CHANGE_DELAY_MS, () => {
      stopWatching = null
      watchedDir = null
      gap = true
      orca.log(`Watcher for ${dir} failed`)
      scheduleRetry()
    })
    if (!stopWatching) {
      gap = true
      scheduleRetry()
      return
    }
    if (gap) {
      gap = false
      changed()
    }
  }

  orca.panels.handle('jobs.list', async () => {
    await ensureWatching()
    return listJobs(orca, store)
  })

  orca.settings.onDidChange(({ key }) => {
    if (key !== 'sessionsDir') return
    stopWatching?.()
    stopWatching = null
    watchedDir = null
    void ensureWatching().then(changed)
  })

  dispose = () => {
    if (retry) clearTimeout(retry)
    retry = null
    stopWatching?.()
    stopWatching = null
  }

  void ensureWatching()
}

export function deactivate(): void {
  dispose?.()
  dispose = null
}
