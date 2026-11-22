// Sidebar-Panel: pro Workspace eine Tabelle der Agenten mit Workflow und Phase.
// Keine Build-Stufe: Orca entfernt die Typen und übersetzt JSX beim Laden.
import {
  atom,
  Badge,
  Box,
  Callout,
  EmptyState,
  Heading,
  IconButton,
  on,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  RelativeTime,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { WorkflowLevel } from './parse'
import type { AgentState, Job, JobsSnapshot, JobWorkflow } from './protocol'

const snapshot = atom<JobsSnapshot | null>(null)
const failure = atom<string | null>(null)

let sequence = 0

/**
 * Solange das Panel sichtbar ist, fragt es in diesem Abstand nach. Das hält den Worker wach,
 * dessen Watcher Phasenwechsel binnen 2 s meldet; Orca beendet einen untätigen Worker sonst.
 */
let keepAliveMs = 15000

/** Nur für Tests. */
export function setKeepAliveMs(ms: number): void {
  keepAliveMs = ms
}

async function refresh(): Promise<void> {
  const mine = ++sequence
  try {
    const answer = await plugin.request('jobs.list')
    if (mine !== sequence) return
    set(snapshot, answer)
    set(failure, null)
  } catch (error) {
    if (mine !== sequence) return
    set(failure, error instanceof Error ? error.message : String(error))
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('jobs.changed', () => void refresh()),
    on('agent.status.changed', () => void refresh()),
    on('workspace.changed', () => void refresh())
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = () => {
    timer = setTimeout(() => {
      if (ctx.signal.aborted) return
      if (read(ctx.visible)) void refresh()
      tick()
    }, keepAliveMs)
  }
  tick()
  ctx.signal.addEventListener('abort', () => clearTimeout(timer))
  void refresh()
}

function levelText(level: WorkflowLevel): string {
  const details: string[] = []
  if (level.stageNumber !== null && level.stageCount !== null) details.push(`${level.stageNumber}/${level.stageCount}`)
  if (level.pendingStage) details.push(`next: ${level.pendingStage}`)
  return `${level.workflow} › ${level.stage}${details.length ? ` (${details.join(', ')})` : ''}`
}

/** Beispiel: `Coding › plan (3/6, next: implement) ⟶ ResultCheck › check (1/2)`. */
export function workflowText(workflow: JobWorkflow): string {
  if (workflow === 'none') return 'no workflow'
  if (workflow === 'unknown') return 'unknown'
  if (workflow.length === 0) return '—'
  return workflow.map(levelText).join(' ⟶ ')
}

const stateTone: Record<AgentState, 'accent' | 'warning' | 'neutral'> = {
  working: 'accent',
  blocked: 'warning',
  waiting: 'warning',
  done: 'neutral'
}

/**
 * Ein Kasten je Job. Die Sidebar ist schmal, deshalb stehen Titel, Workflow sowie Status mit Zeit
 * untereinander; der Workflow bricht um und wird weder abgeschnitten noch versteckt.
 */
function JobRow({ job }: { job: Job }) {
  return (
    <Box border radius="md" padding="sm">
      <Stack gap="xs">
        <Text weight="medium" truncate key={`${job.key}:title`}>
          {job.title}
        </Text>
        <Text size="sm" muted={typeof job.workflow === 'string'} key={`${job.key}:workflow`}>
          {workflowText(job.workflow)}
        </Text>
        <Row gap="xs" align="center">
          <Badge tone={stateTone[job.state]} key={`${job.key}:state`}>
            {job.state}
          </Badge>
          <Text muted size="xs">
            <RelativeTime at={job.stateStartedAt} format="short" key={`${job.key}:since`} />
          </Text>
        </Row>
      </Stack>
    </Box>
  )
}

export default function Panel() {
  const current = read(snapshot)
  const error = read(failure)
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Heading level={2}>Workflow Status</Heading>
        <IconButton icon="refresh" label="Refresh" variant="ghost" size="sm" onPress={refresh} />
      </Row>
      {error ? (
        <Callout tone="danger" title="Could not load agents" icon="error">
          <Text>{error}</Text>
        </Callout>
      ) : null}
      {current === null && !error ? <Skeleton lines={4} label="Loading agents" /> : null}
      {current && current.groups.length === 0 ? (
        <EmptyState title="No agents" description="No workspace on this computer has a running agent." icon="agent" />
      ) : null}
      {(current?.groups ?? []).map((group) => (
        <Stack gap="xs" key={group.workspaceId}>
          <Text weight="semibold" truncate key={`group:${group.workspaceId}`}>
            {group.name}
          </Text>
          {group.error ? (
            <Callout tone="warning" icon="warning">
              <Text>{group.error}</Text>
            </Callout>
          ) : (
            group.jobs.map((job) => <JobRow key={job.key} job={job} />)
          )}
        </Stack>
      ))}
    </Stack>
  )
}
