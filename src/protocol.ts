// Contract between panel and worker, declared once: src/panel/main.ts and src/worker.ts read it.
import type { WorkflowLevel } from './parse'

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'

/**
 * Workflow state of an agent:
 * `none`    — not a Pi agent, so no workflow (for example Claude Code);
 * `unknown` — a Pi agent whose session file cannot be found or read;
 * otherwise the workflow stack, bottom first; empty when no workflow is active.
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
  /** Set when Orca could not list the agents of this workspace. */
  error?: string
}

export type JobsSnapshot = { groups: JobGroup[]; sessionsDir: string }

declare module 'orca' {
  interface PluginRequests {
    /** All agents of all local workspaces with their workflow state. */
    'jobs.list': { output: JobsSnapshot }
  }
  interface PluginPanelEvents {
    /** A Pi session file changed; the panel asks `jobs.list` again. */
    'jobs.changed': { at: number }
  }
}
