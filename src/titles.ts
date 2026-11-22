// Namen der Jobs. `agents.list` liefert keinen Titel, deshalb zwei Quellen:
// 1. Orcas Session-Historie (`agent.listSessions`), exakt über die `sessionId` des Agenten.
// 2. Als Ausweg `orca agent list --json`. Die CLI nennt die Tab-Titel, aber mit eigener ID;
//    ein Titel wird nur übernommen, wenn im Workspace genau ein Agent dieser Art läuft,
//    weil die Zuordnung sonst raten müsste.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

export type CliAgent = { agent?: unknown; worktreeId?: unknown; title?: unknown }

const MAC_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca'

function cliCommand(): string {
  const configured = process.env.ORCA_CLI_COMMAND
  if (configured) return configured
  return existsSync(MAC_CLI) ? MAC_CLI : 'orca'
}

async function readCliAgentsFromOrca(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      cliCommand(),
      ['agent', 'list', '--json'],
      { timeout: 10000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error)
        try {
          const parsed = JSON.parse(stdout) as { result?: unknown }
          resolve(parsed.result)
        } catch (parseError) {
          reject(parseError)
        }
      }
    )
  })
}

let readCliAgents: () => Promise<unknown> = readCliAgentsFromOrca

/** Nur für Tests: ersetzt den Aufruf der CLI. */
export function setCliAgentsReader(reader: () => Promise<unknown>): void {
  readCliAgents = reader
}

/** Agenten aus der CLI; ein Fehler ergibt eine leere Liste. */
export async function cliAgents(): Promise<CliAgent[]> {
  try {
    const result = (await readCliAgents()) as { agents?: unknown } | null
    return Array.isArray(result?.agents) ? (result.agents as CliAgent[]) : []
  } catch {
    return []
  }
}

/** Gehört ein CLI-Agent zu diesem Workspace? CLI-IDs sind `<projekt>::<pfad>` oder `folder:<id>`. */
export function inWorkspace(agent: CliAgent, workspace: { id: string; path: string }): boolean {
  if (typeof agent.worktreeId !== 'string') return false
  if (agent.worktreeId === workspace.id) return true
  const separator = agent.worktreeId.indexOf('::')
  return separator >= 0 && agent.worktreeId.slice(separator + 2) === workspace.path
}

/** Titel des einzigen CLI-Agenten dieser Art im Workspace, sonst null. */
export function uniqueCliTitle(agents: CliAgent[], kind: string | null): string | null {
  if (!kind) return null
  const matches = agents.filter((agent) => agent.agent === kind)
  return matches.length === 1 && typeof matches[0].title === 'string' && matches[0].title.trim()
    ? matches[0].title
    : null
}
