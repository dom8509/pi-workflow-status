// The plugin's worker: collects the agents of all local workspaces, reads each Pi agent's workflow
// state from its session file and reports changed session files to the panel.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentState, Job, JobGroup, JobsSnapshot, JobWorkflow } from './protocol'
import { DEFAULT_SESSIONS_DIR, SessionIndex, expandHome, readWorkflowStack, watchSessions } from './sessions'
import { cliAgents, inWorkspace, uniqueCliTitle, type CliAgent } from './titles'
import { RemoteJobs, localRuntimeId, type RemoteResult } from './remote'

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

const isLocal = (workspace: WorkspaceRow) => workspace.hostId === null || workspace.hostId === 'local'

/** How long `jobs.list` waits for paired servers; later answers follow with `jobs.changed`. */
const REMOTE_BUDGET_MS = 300

async function remoteServers(orca: OrcaWorkerApi): Promise<string[]> {
  const value = await orca.settings.get('remoteServers')
  return typeof value === 'string'
    ? value.split(',').map((name) => name.trim()).filter(Boolean)
    : []
}

/**
 * Workspace of another host that no paired server covered: its agents, with the workflow marked
 * as not readable, because the session files are on that host.
 */
async function unreadableGroup(orca: OrcaWorkerApi, workspace: WorkspaceRow, host: string): Promise<JobGroup | null> {
  try {
    const { agents } = (await orca.host.call('agents.list', { workspaceId: workspace.id })) as { agents: AgentRow[] }
    if (agents.length === 0) return null
    return {
      workspaceId: workspace.id,
      name: workspace.name,
      host,
      jobs: agents.map((agent, position) => ({
        key: keyOf(workspace, agent, position),
        title: agent.title ?? agent.agent ?? 'Agent',
        agent: agent.agent,
        state: agent.state,
        stateStartedAt: agent.stateStartedAt,
        workflow: 'remote' as const
      }))
    }
  } catch (error) {
    return { workspaceId: workspace.id, name: workspace.name, host, jobs: [], error: errorMessage(error) }
  }
}

/**
 * The server that owns a workspace of another host, matched by runtime id. Without a known runtime
 * id the owner stays unknown, so the workspace keeps its unreadable rows instead of vanishing.
 */
function ownerOf(workspace: WorkspaceRow, remote: RemoteResult[]): { name: string; covered: boolean } | null {
  const hostId = workspace.hostId ?? ''
  const owner = remote.find((entry) => entry.runtimeId && hostId === `runtime:${entry.runtimeId}`)
  return owner ? { name: owner.server.name, covered: owner.groups !== null } : null
}

export async function listJobs(
  orca: OrcaWorkerApi,
  store: TitleStore,
  remoteJobs: RemoteJobs | null = null
): Promise<JobsSnapshot> {
  const dir = await sessionsDir(orca)
  const index = new SessionIndex(dir)
  const { workspaces } = (await orca.host.call('workspace.list', {})) as { workspaces: WorkspaceRow[] }
  const remote = remoteJobs ? await remoteJobs.current(await remoteServers(orca), REMOTE_BUDGET_MS) : []
  // A local-only request (from another computer) leaves out other hosts entirely: the asking
  // computer sees them itself, and this one could only attribute them to the wrong host.
  const others = await Promise.all(
    workspaces
      .filter((workspace) => remoteJobs !== null && !isLocal(workspace))
      .map(async (workspace) => {
        const owner = ownerOf(workspace, remote)
        if (owner?.covered) return null
        return unreadableGroup(orca, workspace, owner?.name ?? workspace.hostId ?? 'other host')
      })
  )
  const fetched: Fetched[] = await Promise.all(
    workspaces
      // Session files of this computer only; other hosts come from their own server or as unreadable.
      .filter(isLocal)
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

  const localGroups = new Map<string, JobGroup | null>()
  for (const entry of fetched) {
    if (!('agents' in entry)) {
      localGroups.set(entry.workspace.id, { workspaceId: entry.workspace.id, name: entry.workspace.name, jobs: [], error: entry.error })
    } else if (entry.agents.length > 0) {
      localGroups.set(entry.workspace.id, {
        workspaceId: entry.workspace.id,
        name: entry.workspace.name,
        jobs: jobsOf(entry.workspace, entry.agents, index, store.titles)
      })
    }
  }
  const otherGroups = new Map(
    workspaces
      .filter((workspace) => remoteJobs !== null && !isLocal(workspace))
      .map((workspace, position) => [workspace.id, others[position]])
  )
  // Workspaces in Orca's order, then the jobs each paired server reported.
  const groups: JobGroup[] = workspaces
    .map((workspace) => (isLocal(workspace) ? localGroups.get(workspace.id) : otherGroups.get(workspace.id)) ?? null)
    .filter((group): group is JobGroup => group !== null)
  for (const entry of remote) groups.push(...(entry.groups ?? []))
  if (remoteJobs) return { groups, sessionsDir: dir }
  // The asking computer matches this answer to its `runtime:<id>` workspaces.
  const runtimeId = await localRuntimeId()
  return runtimeId ? { groups, sessionsDir: dir, runtimeId } : { groups, sessionsDir: dir }
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
  const remoteJobs = new RemoteJobs(changed)

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

  orca.panels.handle('jobs.list', async (input) => {
    await ensureWatching()
    // A request from another server's worker lists only this computer, so servers never ask in circles.
    const includeRemote = (input as { includeRemote?: boolean } | null)?.includeRemote !== false
    return listJobs(orca, store, includeRemote ? remoteJobs : null)
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
