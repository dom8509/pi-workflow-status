// Contract between panel and worker, declared once: src/panel/main.ts and src/worker.ts read it.
import type { WorkflowLevel } from './parse'

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'

/**
 * Workflow state of an agent:
 * `none`    — not a Pi agent, so no workflow (for example Claude Code);
 * `unknown` — a Pi agent whose session file cannot be found or read;
 * `remote`  — an agent on another host whose server did not answer, so its session is not readable;
 * otherwise the workflow stack, bottom first; empty when no workflow is active.
 */
export type JobWorkflow = 'none' | 'unknown' | 'remote' | WorkflowLevel[]

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
  /** Name of the paired server or host the workspace runs on; missing for this computer. */
  host?: string
  /** Set when Orca could not list the agents of this workspace. */
  error?: string
}

export type JobsSnapshot = {
  groups: JobGroup[]
  sessionsDir: string
  /** Runtime id of the answering Orca; set in answers to other computers. */
  runtimeId?: string
}

declare module 'orca' {
  interface PluginRequests {
    /** All agents of all local workspaces with their workflow state. */
    'jobs.list': { input?: { includeRemote?: boolean }; output: JobsSnapshot }
  }
  interface PluginPanelEvents {
    /** A Pi session file changed; the panel asks `jobs.list` again. */
    'jobs.changed': { at: number }
  }
}
