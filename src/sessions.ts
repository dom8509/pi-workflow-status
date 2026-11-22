// Findet Pi-Session-Dateien. Gelesen wird ausschließlich unterhalb des Sessions-Ordners.
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
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

/** Ordnername, unter dem Pi die Sessions eines Arbeitsverzeichnisses ablegt. */
export function sessionDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

function isInside(dir: string, file: string): boolean {
  const base = resolve(dir)
  const target = resolve(file)
  return target.startsWith(base.endsWith(sep) ? base : base + sep)
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

/** Index aller Session-Dateien eines Durchlaufs: Pi-Session-ID → Pfad. */
export class SessionIndex {
  private byId: Map<string, string> | null = null

  constructor(readonly dir: string) {}

  private index(): Map<string, string> {
    if (this.byId) return this.byId
    this.byId = new Map()
    for (const sub of subdirs(this.dir)) {
      for (const name of jsonlFiles(sub)) {
        // Dateiname: <Zeitstempel>_<Session-ID>.jsonl
        const id = name.slice(name.lastIndexOf('_') + 1, -'.jsonl'.length)
        if (id) this.byId.set(id, join(sub, name))
      }
    }
    return this.byId
  }

  /**
   * Orca nennt eine Pi-Session entweder mit ihrer ID oder mit dem Pfad ihrer Datei.
   * Ein Pfad außerhalb des Sessions-Ordners wird nicht gelesen.
   */
  find(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null
    if (isAbsolute(sessionId)) {
      return sessionId.endsWith('.jsonl') && isInside(this.dir, sessionId) && existsSync(sessionId)
        ? sessionId
        : null
    }
    return this.index().get(sessionId) ?? null
  }

  /** Die zuletzt geschriebene Session eines Arbeitsverzeichnisses. */
  newestFor(cwd: string): string | null {
    const dir = join(this.dir, sessionDirName(cwd))
    let newest: { path: string; mtime: number } | null = null
    for (const name of jsonlFiles(dir)) {
      const path = join(dir, name)
      try {
        const mtime = statSync(path).mtimeMs
        if (!newest || mtime > newest.mtime) newest = { path, mtime }
      } catch {
        // Datei zwischen Auflisten und Lesen verschwunden.
      }
    }
    return newest?.path ?? null
  }
}

/** Workflow-Stapel einer Session-Datei, null wenn sie nicht lesbar ist. */
export function readWorkflowStack(path: string): WorkflowLevel[] | null {
  try {
    return parseWorkflowStack(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Ruft `onChange` auf, sobald eine Session-Datei geschrieben wurde, gebündelt über `delayMs`.
 * Gibt eine Funktion zum Beenden zurück; ein fehlender Ordner liefert `null`.
 */
export function watchSessions(dir: string, onChange: () => void, delayMs: number): (() => void) | null {
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
    watcher.on('error', () => undefined)
    return () => {
      if (timer) clearTimeout(timer)
      watcher.close()
    }
  } catch {
    return null
  }
}
