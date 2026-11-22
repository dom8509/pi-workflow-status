// Job names. `agents.list` returns no title, so there are two sources:
// 1. Orca's session history (`agent.listSessions`), matched exactly by the agent's `sessionId`.
// 2. As a fallback `orca agent list --json`. The CLI has the tab titles but its own ids; a title
//    is used only when exactly one agent of that kind runs in the workspace, because the match
//    would otherwise be a guess.
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

/** Tests only: replaces the CLI call. */
export function setCliAgentsReader(reader: () => Promise<unknown>): void {
  readCliAgents = reader
  cache = null
  pending = null
}

/** `jobs.list` waits no longer for the CLI, so stage changes still show within 2 s. */
export const CLI_BUDGET_MS = 1500
/** How long a CLI answer stays valid; tab titles rarely change. */
const CLI_CACHE_MS = 30000

let cache: { at: number; agents: CliAgent[] } | null = null
let pending: Promise<CliAgent[]> | null = null

function fetchCliAgents(): Promise<CliAgent[]> {
  if (!pending) {
    pending = readCliAgents()
      .then((result) => {
        const agents = (result as { agents?: unknown } | null)?.agents
        const list = Array.isArray(agents) ? (agents as CliAgent[]) : []
        cache = { at: Date.now(), agents: list }
        return list
      })
      .catch(() => [] as CliAgent[])
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/**
 * Agents from the CLI. An error yields an empty list; if the CLI takes longer than
 * `CLI_BUDGET_MS`, the last answer or an empty list applies, and the running call fills the
 * cache for the next pass.
 */
export async function cliAgents(): Promise<CliAgent[]> {
  if (cache && Date.now() - cache.at < CLI_CACHE_MS) return cache.agents
  const fallback = cache?.agents ?? []
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<CliAgent[]>((resolve) => {
    timer = setTimeout(() => resolve(fallback), CLI_BUDGET_MS)
  })
  try {
    return await Promise.race([fetchCliAgents(), budget])
  } finally {
    clearTimeout(timer)
  }
}

/** Does a CLI agent belong to this workspace? CLI ids are `<project>::<path>` or `folder:<id>`. */
export function inWorkspace(agent: CliAgent, workspace: { id: string; path: string }): boolean {
  if (typeof agent.worktreeId !== 'string') return false
  if (agent.worktreeId === workspace.id) return true
  const separator = agent.worktreeId.indexOf('::')
  return separator >= 0 && agent.worktreeId.slice(separator + 2) === workspace.path
}

/** Title of the only CLI agent of this kind in the workspace, otherwise null. */
export function uniqueCliTitle(agents: CliAgent[], kind: string | null): string | null {
  if (!kind) return null
  const matches = agents.filter((agent) => agent.agent === kind)
  return matches.length === 1 && typeof matches[0].title === 'string' && matches[0].title.trim()
    ? matches[0].title
    : null
}
