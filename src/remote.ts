// Jobs of paired Orca servers. Pi session files live on the machine that runs the job, so the
// worker asks the same plugin on each paired server through Orca's CLI:
//   orca plugin dev request local.pi-workflow-status jobs.list --environment <server>
// Orca accepts this only for a plugin loaded as a development folder on that server.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { JobGroup, JobsSnapshot } from './protocol'

export const REMOTE_PLUGIN_KEY = 'local.pi-workflow-status'

/** How long an answer of a server stays valid before the worker asks again. */
const REMOTE_CACHE_MS = 5000
/** How long one server may take to answer. */
const REMOTE_TIMEOUT_MS = 20_000

export type RemoteServer = { id: string; name: string; runtimeId: string | null }

const MAC_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca'

function cliCommand(): string {
  const configured = process.env.ORCA_CLI_COMMAND
  if (configured) return configured
  return existsSync(MAC_CLI) ? MAC_CLI : 'orca'
}

function runOrcaCli(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(cliCommand(), args, { timeout: REMOTE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(stdout)
      } catch {
        // Not JSON: report the process error below.
      }
      const failure = (parsed as { error?: { message?: string } } | null)?.error?.message
      if (failure) return reject(new Error(failure))
      if (error) return reject(error)
      resolve(parsed)
    })
  })
}

let runCli: (args: string[]) => Promise<unknown> = runOrcaCli

/** Tests only: replaces the CLI call. */
export function setRemoteCli(runner: (args: string[]) => Promise<unknown>): void {
  runCli = runner
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Saved paired servers, limited to the names or ids in `filter` when it lists any. */
export async function listServers(filter: string[]): Promise<RemoteServer[]> {
  const answer = (await runCli(['environment', 'list', '--json'])) as { result?: { environments?: unknown } } | null
  const raw = answer?.result?.environments
  const servers = (Array.isArray(raw) ? raw : []).flatMap((entry): RemoteServer[] => {
    const record = (entry ?? {}) as Record<string, unknown>
    const id = text(record.id) ?? text(record.name)
    if (!id) return []
    return [{ id, name: text(record.name) ?? id, runtimeId: text(record.runtimeId) }]
  })
  if (filter.length === 0) return servers
  return servers.filter((server) => filter.includes(server.name) || filter.includes(server.id))
}

/** The local jobs of one server, as its own worker lists them. */
async function askServer(server: RemoteServer): Promise<JobGroup[]> {
  const answer = (await runCli([
    'plugin', 'dev', 'request', REMOTE_PLUGIN_KEY, 'jobs.list',
    '--data', JSON.stringify({ includeRemote: false }),
    '--environment', server.id,
    '--timeout-ms', String(REMOTE_TIMEOUT_MS),
    '--json'
  ])) as { result?: { result?: JobsSnapshot } } | null
  const snapshot = answer?.result?.result
  if (!snapshot || !Array.isArray(snapshot.groups)) throw new Error('unexpected answer')
  // Ids of one server must not collide with local ones or another server's.
  return snapshot.groups.map((group) => ({
    ...group,
    workspaceId: `${server.id}/${group.workspaceId}`,
    host: server.name,
    jobs: group.jobs.map((job) => ({ ...job, key: `${server.id}/${job.key}` }))
  }))
}

export type RemoteResult = { server: RemoteServer; groups: JobGroup[] | null }

/**
 * Answers of all servers, cached per server. `current()` returns at once what is known; a server
 * whose answer is older than `REMOTE_CACHE_MS` is asked again in the background, and `onChange`
 * runs when a new answer arrives.
 */
export class RemoteJobs {
  private servers: RemoteServer[] = []
  private answers = new Map<string, { at: number; groups: JobGroup[] | null }>()
  private pending = new Set<string>()
  private listing: Promise<void> | null = null
  private listedAt = 0

  constructor(private readonly onChange: () => void) {}

  /** Starts refreshing what is stale and resolves once fresh answers arrived or `waitMs` passed. */
  async current(filter: string[], waitMs: number): Promise<RemoteResult[]> {
    const work = this.refresh(filter)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([work, new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))])
    clearTimeout(timer)
    return this.servers.map((server) => ({ server, groups: this.answers.get(server.id)?.groups ?? null }))
  }

  private async refresh(filter: string[]): Promise<void> {
    const now = Date.now()
    if (!this.listing && now - this.listedAt >= REMOTE_CACHE_MS) {
      this.listing = listServers(filter)
        .then((servers) => {
          this.servers = servers
        })
        .catch(() => {
          this.servers = []
        })
        .finally(() => {
          this.listedAt = Date.now()
          this.listing = null
        })
    }
    if (this.listing) await this.listing
    await Promise.all(
      this.servers.map(async (server) => {
        const known = this.answers.get(server.id)
        if (this.pending.has(server.id) || (known && Date.now() - known.at < REMOTE_CACHE_MS)) return
        this.pending.add(server.id)
        let groups: JobGroup[] | null
        try {
          groups = await askServer(server)
        } catch {
          groups = null
        }
        this.pending.delete(server.id)
        const changed = JSON.stringify(known?.groups ?? null) !== JSON.stringify(groups)
        this.answers.set(server.id, { at: Date.now(), groups })
        if (changed) this.onChange()
      })
    )
  }
}
