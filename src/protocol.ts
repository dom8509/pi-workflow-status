// Vertrag zwischen Panel und Worker, einmal deklariert: src/panel.tsx und src/worker.ts lesen ihn.
import type { WorkflowLevel } from './parse'

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'

/**
 * Workflow-Zustand eines Agenten:
 * `none`    — der Agent ist kein Pi-Agent, er hat keinen Workflow (zum Beispiel Claude Code);
 * `unknown` — Pi-Agent, aber seine Session-Datei ist nicht auffindbar oder nicht lesbar;
 * sonst der Workflow-Stapel, unten zuerst; leer, wenn kein Workflow aktiv ist.
 */
export type JobWorkflow = 'none' | 'unknown' | WorkflowLevel[]

export type Job = {
  key: string
  title: string
  agent: string | null
  state: AgentState
  stateStartedAt: number
  workflow: JobWorkflow
}

export type JobGroup = {
  workspaceId: string
  name: string
  jobs: Job[]
  /** Gesetzt, wenn Orca die Agenten dieses Workspaces nicht liefern konnte. */
  error?: string
}

export type JobsSnapshot = { groups: JobGroup[]; sessionsDir: string }

declare module 'orca' {
  interface PluginRequests {
    /** Alle Agenten aller lokalen Workspaces mit ihrem Workflow-Zustand. */
    'jobs.list': { output: JobsSnapshot }
  }
  interface PluginPanelEvents {
    /** Eine Pi-Session-Datei hat sich geändert; das Panel fragt `jobs.list` neu ab. */
    'jobs.changed': { at: number }
  }
}
