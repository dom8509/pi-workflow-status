// Sidebar-Panel: pro Workspace eine Tabelle der Agenten mit Workflow und Phase.
// Keine Build-Stufe: Orca entfernt die Typen und übersetzt JSX beim Laden.
import {
  atom,
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
  Stack,
  Table,
  Text,
  type PanelContext,
  type TableColumn,
  type TableRow
} from 'orca'
import type { WorkflowLevel } from './parse'
import type { Job, JobsSnapshot, JobWorkflow } from './protocol'

const snapshot = atom<JobsSnapshot | null>(null)
const failure = atom<string | null>(null)

let sequence = 0

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

const columns: readonly TableColumn[] = [
  { key: 'agent', label: 'Agent', width: 'auto', minWidth: 'sm' },
  { key: 'workflow', label: 'Workflow', width: 'auto', minWidth: 'md' },
  { key: 'state', label: 'State', width: 'sm', hideBelow: 'sm' },
  { key: 'since', label: 'Since', width: 'xs', hideBelow: 'md' }
]

function rowOf(job: Job): TableRow {
  return {
    key: job.key,
    cells: {
      agent: job.title,
      workflow: workflowText(job.workflow),
      state: job.state,
      since: { type: 'relative', at: job.stateStartedAt, format: 'short' }
    }
  }
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
          <Text weight="semibold" truncate>
            {group.name}
          </Text>
          {group.error ? (
            <Callout tone="warning" icon="warning">
              <Text>{group.error}</Text>
            </Callout>
          ) : (
            <Table label={`Agents in ${group.name}`} columns={columns} rows={group.jobs.map(rowOf)} />
          )}
        </Stack>
      ))}
    </Stack>
  )
}
