// Minimale Typen der Node-Module, die der Worker nutzt. Das Plugin hat keine npm-Abhängigkeiten,
// also auch kein @types/node.
declare module 'node:fs' {
  export type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean }
  export type Stats = { mtimeMs: number; isFile(): boolean }
  export type FSWatcher = { close(): void; on(event: 'error', listener: (error: Error) => void): FSWatcher }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[]
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function statSync(path: string): Stats
  export function existsSync(path: string): boolean
  export function mkdtempSync(prefix: string): string
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function writeFileSync(path: string, data: string): void
  export function appendFileSync(path: string, data: string): void
  export function utimesSync(path: string, atime: number, mtime: number): void
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  export function watch(
    path: string,
    options: { recursive?: boolean; persistent?: boolean },
    listener: (event: string, filename: string | null) => void
  ): FSWatcher
}
declare module 'node:os' {
  export function homedir(): string
  export function tmpdir(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
  export function resolve(...parts: string[]): string
  export function isAbsolute(path: string): boolean
  export const sep: string
}
declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: readonly string[],
    options: { timeout?: number; maxBuffer?: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ): unknown
}
declare const process: { env: Record<string, string | undefined> }
