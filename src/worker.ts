// Worker des Plugins: sammelt die Agenten aller lokalen Workspaces, liest zu jedem Pi-Agenten
// den Workflow-Zustand aus seiner Session-Datei und meldet geänderte Session-Dateien ans Panel.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentState, Job, JobGroup, JobsSnapshot, JobWorkflow } from './protocol'
import { DEFAULT_SESSIONS_DIR, SessionIndex, expandHome, readWorkflowStack, watchSessions } from './sessions'
import { cliAgents, inWorkspace, uniqueCliTitle, type CliAgent } from './titles'

/** Wartezeit, mit der mehrere Schreibvorgänge zu einer Meldung gebündelt werden. */
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

/** Titel aus Orcas Session-Historie für diesen Workspace, nach `sessionId`. */
async function historyTitles(orca: OrcaWorkerApi, workspace: WorkspaceRow, agents: AgentRow[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  if (!agents.some((agent) => agent.sessionId)) return titles
  try {
    const { sessions } = await orca.host.call('agent.listSessions', { workspaceId: workspace.id, limit: 200 })
    for (const entry of sessions) if (entry.title.trim()) titles.set(entry.sessionId, entry.title)
  } catch {
    // Ohne Historie bleibt der Ausweg über die CLI.
  }
  return titles
}

/**
 * Schlüssel, unter denen die Historie eine Session nennen kann. Bei Pi liefert `agents.list` den
 * Pfad der Session-Datei, die Historie die Pi-Session-ID aus dem Dateinamen
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

function titleOf(agent: AgentRow, history: Map<string, string>, cli: CliAgent[], agents: AgentRow[]): string {
  if (agent.title) return agent.title
  const exact = historyTitle(agent, history)
  if (exact) return exact
  const sameKind = agents.filter((other) => other.agent === agent.agent).length
  const fromCli = sameKind === 1 ? uniqueCliTitle(cli, agent.agent) : null
  return fromCli ?? agent.agent ?? 'Agent'
}

function jobsOf(
  workspace: WorkspaceRow,
  agents: AgentRow[],
  index: SessionIndex,
  history: Map<string, string>,
  cli: CliAgent[]
): Job[] {
  const paths = agents.map((agent) => (agent.agent === 'pi' ? index.find(agent.sessionId) : null))
  const pi = agents.filter((agent) => agent.agent === 'pi')
  // Ohne passende sessionId nur dann die neueste Session des Workspaces, wenn sie eindeutig
  // zu genau einem Pi-Agenten gehören kann.
  const fallback = pi.length === 1 ? index.newestFor(workspace.path) : null
  return agents.map((agent, position) => ({
    key: agent.terminalId ?? `${workspace.id}#${position}`,
    title: titleOf(agent, history, cli, agents),
    agent: agent.agent,
    state: agent.state,
    stateStartedAt: agent.stateStartedAt,
    workflow: agent.agent === 'pi' ? workflowOf(paths[position] ?? fallback) : 'none'
  }))
}

export async function listJobs(orca: OrcaWorkerApi): Promise<JobsSnapshot> {
  const dir = await sessionsDir(orca)
  const index = new SessionIndex(dir)
  const { workspaces } = (await orca.host.call('workspace.list', {})) as { workspaces: WorkspaceRow[] }
  // Alle Workspaces parallel; die CLI wird höchstens einmal je Durchlauf gefragt.
  let cli: Promise<CliAgent[]> | null = null
  const groups = await Promise.all(
    workspaces
      // Nur dieser Rechner: Sessions anderer Hosts liegen nicht im lokalen Sessions-Ordner.
      .filter((workspace) => workspace.hostId === null || workspace.hostId === 'local')
      .map(async (workspace): Promise<JobGroup | null> => {
        try {
          const { agents } = (await orca.host.call('agents.list', { workspaceId: workspace.id })) as {
            agents: AgentRow[]
          }
          if (agents.length === 0) return null
          const history = await historyTitles(orca, workspace, agents)
          const needsCli = agents.some((agent) => !agent.title && !historyTitle(agent, history))
          if (needsCli && cli === null) cli = cliAgents()
          const local = needsCli ? (await (cli ?? Promise.resolve([]))).filter((agent) => inWorkspace(agent, workspace)) : []
          return { workspaceId: workspace.id, name: workspace.name, jobs: jobsOf(workspace, agents, index, history, local) }
        } catch (error) {
          return { workspaceId: workspace.id, name: workspace.name, jobs: [], error: errorMessage(error) }
        }
      })
  )
  return { groups: groups.filter((group): group is JobGroup => group !== null), sessionsDir: dir }
}

export default function activate(orca: OrcaWorkerApi): void {
  let stopWatching: (() => void) | null = null
  let watchedDir: string | null = null

  async function ensureWatching(): Promise<void> {
    const dir = await sessionsDir(orca)
    if (dir === watchedDir && stopWatching) return
    stopWatching?.()
    watchedDir = dir
    stopWatching = watchSessions(
      dir,
      () => orca.panels.post('jobs.changed', { at: Date.now() }),
      CHANGE_DELAY_MS,
      () => {
        // Beim nächsten jobs.list neu anlegen.
        stopWatching = null
        watchedDir = null
        orca.log(`Watcher für ${dir} ausgefallen`)
      }
    )
    if (!stopWatching) orca.log(`Sessions-Ordner nicht beobachtbar: ${dir}`)
  }

  orca.panels.handle('jobs.list', async () => {
    await ensureWatching()
    return listJobs(orca)
  })

  orca.settings.onDidChange(({ key }) => {
    if (key !== 'sessionsDir') return
    stopWatching?.()
    stopWatching = null
    watchedDir = null
    void ensureWatching().then(() => orca.panels.post('jobs.changed', { at: Date.now() }))
  })

  void ensureWatching()
}

export function deactivate(): void {
  // Der Watcher hält den Prozess nicht am Leben (`persistent: false`); Orca beendet den Worker.
}
