// Worker des Plugins: sammelt die Agenten aller lokalen Workspaces, liest zu jedem Pi-Agenten
// den Workflow-Zustand aus seiner Session-Datei und meldet geänderte Session-Dateien ans Panel.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentState, Job, JobGroup, JobsSnapshot, JobWorkflow } from './protocol'
import { DEFAULT_SESSIONS_DIR, SessionIndex, expandHome, readWorkflowStack, watchSessions } from './sessions'

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

function jobsOf(workspace: WorkspaceRow, agents: AgentRow[], index: SessionIndex): Job[] {
  const paths = agents.map((agent) => (agent.agent === 'pi' ? index.find(agent.sessionId) : null))
  const pi = agents.filter((agent) => agent.agent === 'pi')
  // Ohne passende sessionId nur dann die neueste Session des Workspaces, wenn sie eindeutig
  // zu genau einem Pi-Agenten gehören kann.
  const fallback = pi.length === 1 ? index.newestFor(workspace.path) : null
  return agents.map((agent, position) => ({
    key: agent.terminalId ?? `${workspace.id}#${position}`,
    title: agent.title ?? agent.agent ?? 'Agent',
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
  const groups: JobGroup[] = []
  for (const workspace of workspaces) {
    // Nur dieser Rechner: Sessions anderer Hosts liegen nicht im lokalen Sessions-Ordner.
    if (workspace.hostId !== null && workspace.hostId !== 'local') continue
    try {
      const { agents } = (await orca.host.call('agents.list', { workspaceId: workspace.id })) as {
        agents: AgentRow[]
      }
      if (agents.length === 0) continue
      groups.push({ workspaceId: workspace.id, name: workspace.name, jobs: jobsOf(workspace, agents, index) })
    } catch (error) {
      groups.push({ workspaceId: workspace.id, name: workspace.name, jobs: [], error: errorMessage(error) })
    }
  }
  return { groups, sessionsDir: dir }
}

export default function activate(orca: OrcaWorkerApi): void {
  let stopWatching: (() => void) | null = null
  let watchedDir: string | null = null

  async function ensureWatching(): Promise<void> {
    const dir = await sessionsDir(orca)
    if (dir === watchedDir && stopWatching) return
    stopWatching?.()
    watchedDir = dir
    stopWatching = watchSessions(dir, () => orca.panels.post('jobs.changed', { at: Date.now() }), CHANGE_DELAY_MS)
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
