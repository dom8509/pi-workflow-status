// Prüft das Panel gegen einen Mock des Workers (`jobs.list`) und Orca-Ereignisse.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import type { JobsSnapshot } from './protocol'
import * as panel from './panel'

const snapshot: JobsSnapshot = {
  sessionsDir: '/Users/dom/.pi/agent/sessions',
  groups: [
    {
      workspaceId: 'ws-a',
      name: 'hearturchin',
      jobs: [
        {
          key: 't1',
          title: 'Coordinator',
          agent: 'pi',
          state: 'working',
          stateStartedAt: 1000,
          workflow: [
            { workflow: 'Coding', stage: 'plan', stageNumber: 3, stageCount: 6, pendingStage: 'implement' },
            { workflow: 'ResultCheck', stage: 'check', stageNumber: 1, stageCount: 2 }
          ]
        },
        { key: 't2', title: 'Idle pi', agent: 'pi', state: 'done', stateStartedAt: 900, workflow: [] },
        { key: 't3', title: 'Lost pi', agent: 'pi', state: 'done', stateStartedAt: 900, workflow: 'unknown' }
      ]
    },
    {
      workspaceId: 'ws-b',
      name: 'BM-225',
      jobs: [{ key: 't4', title: 'BM-225 (w3)', agent: 'claude', state: 'blocked', stateStartedAt: 2000, workflow: 'none' }]
    },
    { workspaceId: 'ws-c', name: 'broken', jobs: [], error: 'kaputt' }
  ]
}

function rowsOf(view: Awaited<ReturnType<typeof mount>>, workspace: string) {
  const table = view.find({ type: 'Table', label: `Agents in ${workspace}` })
  assert.ok(table, `keine Tabelle für ${workspace}`)
  return (table.props.rows as { key: string; cells: Record<string, unknown> }[]).map((row) => ({
    key: row.key,
    ...row.cells
  }))
}

test('zeigt pro Workspace eine Tabelle mit Workflow und Phase (AK1, AK2, AK4)', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'jobs.list': snapshot } }) })
  assert.deepEqual(rowsOf(view, 'hearturchin'), [
    {
      key: 't1',
      agent: 'Coordinator',
      workflow: 'Coding › plan (3/6, next: implement) ⟶ ResultCheck › check (1/2)',
      state: 'working',
      since: { type: 'relative', at: 1000, format: 'short' }
    },
    { key: 't2', agent: 'Idle pi', workflow: '—', state: 'done', since: { type: 'relative', at: 900, format: 'short' } },
    { key: 't3', agent: 'Lost pi', workflow: 'unknown', state: 'done', since: { type: 'relative', at: 900, format: 'short' } }
  ])
  assert.deepEqual(rowsOf(view, 'BM-225'), [
    {
      key: 't4',
      agent: 'BM-225 (w3)',
      workflow: 'no workflow',
      state: 'blocked',
      since: { type: 'relative', at: 2000, format: 'short' }
    }
  ])
  assert.ok(view.find({ text: /kaputt/ }), 'Fehler des Workspaces fehlt')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('fragt bei Agent-Status, Workspace-Wechsel und geänderter Session neu ab (AK5)', async () => {
  let calls = 0
  const host = mockHost({
    requests: {
      'jobs.list': () => {
        calls += 1
        return calls === 1 ? { ...snapshot, groups: [] } : snapshot
      }
    }
  })
  const view = await mount(panel, { host })
  assert.equal(calls, 1)
  assert.ok(view.find({ type: 'EmptyState' }))

  await view.post('jobs.changed', { at: 1 })
  assert.equal(calls, 2)
  assert.ok(view.find({ type: 'Table', label: 'Agents in hearturchin' }))

  await view.emit('agent.status.changed', {
    workspaceId: 'ws-a',
    paneKey: 'p',
    terminalId: 't1',
    state: 'waiting',
    receivedAt: 5
  })
  assert.equal(calls, 3)

  await view.emit('workspace.changed', { context: null })
  assert.equal(calls, 4)
  await view.unmount()
})

test('zeigt einen Fehler, wenn der Worker nicht antwortet', async () => {
  const host = mockHost({
    requests: {
      'jobs.list': () => {
        throw hostError('unavailable', 'worker down')
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'Callout', text: /worker down/ }))
  await view.unmount()
})
