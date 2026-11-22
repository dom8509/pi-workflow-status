// Prüft das Panel gegen einen Mock des Workers (`jobs.list`) und Orca-Ereignisse.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import type { JobsSnapshot } from './protocol'
import * as panel from './panel'
import { setKeepAliveMs } from './panel'

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

/** Was eine Job-Zeile zeigt: Titel, Workflow, Status und die Zeit seit dem Wechsel. */
function jobOf(view: Awaited<ReturnType<typeof mount>>, key: string) {
  assert.ok(view.find({ testId: `${key}:title` }), `keine Zeile ${key}`)
  return {
    title: view.findAll({ testId: `${key}:title` })[0]?.text,
    workflow: view.findAll({ testId: `${key}:workflow` })[0]?.text,
    state: view.findAll({ testId: `${key}:state` })[0]?.text,
    since: (view.findAll({ testId: `${key}:since` })[0]?.props as { at?: number } | undefined)?.at
  }
}

test('zeigt pro Workspace die Jobs mit Workflow, Phase, Status und Zeit (AK1, AK2, AK4)', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'jobs.list': snapshot } }) })
  assert.deepEqual(jobOf(view, 't1'), {
    title: 'Coordinator',
    workflow: 'Coding › plan (3/6, next: implement) ⟶ ResultCheck › check (1/2)',
    state: 'working',
    since: 1000
  })
  assert.deepEqual(jobOf(view, 't2'), { title: 'Idle pi', workflow: '—', state: 'done', since: 900 })
  assert.deepEqual(jobOf(view, 't3'), { title: 'Lost pi', workflow: 'unknown', state: 'done', since: 900 })
  assert.deepEqual(jobOf(view, 't4'), { title: 'BM-225 (w3)', workflow: 'no workflow', state: 'blocked', since: 2000 })
  assert.equal(view.find({ testId: 'group:ws-a' })?.text, 'hearturchin')
  assert.equal(view.find({ testId: 'group:ws-b' })?.text, 'BM-225')
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
  assert.ok(view.find({ testId: 't1:title' }))

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

test('solange das Panel sichtbar ist, fragt es regelmäßig nach und hält so den Worker wach (AK5)', async () => {
  setKeepAliveMs(40)
  let calls = 0
  const host = mockHost({ requests: { 'jobs.list': () => ((calls += 1), snapshot) } })
  const view = await mount(panel, { host })
  const started = Date.now()
  while (calls < 3 && Date.now() - started < 2000) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(calls >= 3, `nur ${calls} Abfragen`)
  view.setVisible(false)
  await view.settled()
  const hidden = calls
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.ok(calls <= hidden + 1, `verstecktes Panel fragte ${calls - hidden}-mal nach`)
  await view.unmount()
  setKeepAliveMs(15000)
})
