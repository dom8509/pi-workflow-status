// Finds Pi session files. Only files below the sessions folder are read.
import { readdirSync, readFileSync, realpathSync, statSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { parseWorkflowStack, type WorkflowLevel } from './parse'

export const DEFAULT_SESSIONS_DIR = '~/.pi/agent/sessions'

export function expandHome(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

/** Folder name under which Pi stores the sessions of a working directory. */
export function sessionDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

/**
 * Is the file below the folder once all symbolic links are resolved? A link pointing out of the
 * sessions folder counts as outside, and so does a missing file.
 */
function isInside(dir: string, file: string): boolean {
  try {
    const base = realpathSync(resolve(dir))
    const target = realpathSync(resolve(file))
    return target.startsWith(base.endsWith(sep) ? base : base + sep)
  } catch {
    return false
  }
}

function jsonlFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
  } catch {
    return []
  }
}

/** Index of all session files for one pass: Pi session id → path. */
export class SessionIndex {
  private byId: Map<string, string> | null = null

  constructor(readonly dir: string) {}

  private index(): Map<string, string> {
    if (this.byId) return this.byId
    this.byId = new Map()
    for (const sub of subdirs(this.dir)) {
      for (const name of jsonlFiles(sub)) {
        // File name: <timestamp>_<session id>.jsonl
        const id = name.slice(name.lastIndexOf('_') + 1, -'.jsonl'.length)
        const path = join(sub, name)
        if (id && isInside(this.dir, path)) this.byId.set(id, path)
      }
    }
    return this.byId
  }

  /**
   * Orca names a Pi session either by its id or by the path of its file.
   * A path outside the sessions folder is not read.
   */
  find(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null
    if (isAbsolute(sessionId)) {
      return sessionId.endsWith('.jsonl') && isInside(this.dir, sessionId) ? sessionId : null
    }
    return this.index().get(sessionId) ?? null
  }

  /** The most recently written session of a working directory. */
  newestFor(cwd: string): string | null {
    const dir = join(this.dir, sessionDirName(cwd))
    let newest: { path: string; mtime: number } | null = null
    for (const name of jsonlFiles(dir)) {
      const path = join(dir, name)
      if (!isInside(this.dir, path)) continue
      try {
        const mtime = statSync(path).mtimeMs
        if (!newest || mtime > newest.mtime) newest = { path, mtime }
      } catch {
        // The file disappeared between listing and reading.
      }
    }
    return newest?.path ?? null
  }
}

/** Workflow stack of a session file, null when it cannot be read. */
export function readWorkflowStack(path: string): WorkflowLevel[] | null {
  try {
    return parseWorkflowStack(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Calls `onChange` once a session file was written, batched over `delayMs`.
 * Returns a function that stops watching; a missing folder returns `null`. If the watcher fails
 * later it calls `onFailure` so the caller can create it again.
 */
export function watchSessions(
  dir: string,
  onChange: () => void,
  delayMs: number,
  onFailure: () => void = () => undefined
): (() => void) | null {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const watcher = watch(dir, { recursive: true, persistent: false }, (_event, filename) => {
      if (filename && !filename.endsWith('.jsonl')) return
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, delayMs)
    })
    const stop = () => {
      if (timer) clearTimeout(timer)
      timer = null
      watcher.close()
    }
    watcher.on('error', () => {
      stop()
      onFailure()
    })
    return stop
  } catch {
    return null
  }
}
