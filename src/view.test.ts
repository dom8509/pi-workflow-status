// Prüft das Ansichtsmodell des HTML-Panels: Activity-Liste, Auswahl und Pipeline.
import { assert, test } from 'orca/testing'
import type { JobsSnapshot } from './protocol'
import { activityOf, pipelineOf, renderPanel, selectJob } from './view'

const codingStages = [
  { id: 'understand', description: 'Collect the facts' },
  { id: 'specify', description: 'Define the behavior' },
  { id: 'plan', description: 'Agree a short plan' },
  { id: 'implement', description: 'Implement the approved plan' }
]

const snapshot: JobsSnapshot = {
  sessionsDir: '/s',
  groups: [
    {
      workspaceId: 'ws-a',
      name: 'main',
      jobs: [
        { key: 'a1', title: 'Old claude', agent: 'claude', state: 'done', stateStartedAt: 100, workflow: 'none' },
        {
          key: 'a2',
          title: 'Plugin <bauen>',
          agent: 'pi',
          state: 'working',
          stateStartedAt: 50,
          workflow: [
            { workflow: 'Coding', stage: 'plan', stageNumber: 3, stageCount: 4, pendingStage: 'implement', stages: codingStages },
            {
              workflow: 'ResultCheck',
              stage: 'check',
              stageNumber: 1,
              stageCount: 2,
              stages: [
                { id: 'check', description: 'Compare results' },
                { id: 'decide', description: 'Allow or block' }
              ]
            }
          ]
        }
      ]
    },
    {
      workspaceId: 'ws-b',
      name: 'hearturchin',
      jobs: [{ key: 'b1', title: 'Idle pi', agent: 'pi', state: 'done', stateStartedAt: 300, workflow: [] }]
    },
    { workspaceId: 'ws-c', name: 'broken', jobs: [], error: 'kaputt' }
  ]
}

test('die Activity-Liste zeigt laufende Jobs zuerst, dann die zuletzt geänderten', () => {
  assert.deepEqual(
    activityOf(snapshot).map((item) => [item.key, item.workspace, item.summary]),
    [
      ['a2', 'main', 'Coding · plan › ResultCheck · check'],
      ['b1', 'hearturchin', 'no active workflow'],
      ['a1', 'main', 'no workflow']
    ]
  )
})

test('ohne gültige Auswahl ist der erste Job mit aktivem Workflow ausgewählt (O9-1)', () => {
  const items = activityOf(snapshot)
  assert.equal(selectJob(items, null), 'a2')
  assert.equal(selectJob(items, 'gibt-es-nicht'), 'a2')
  assert.equal(selectJob(items, 'b1'), 'b1')
  assert.equal(selectJob([], 'b1'), null)
})

test('die Pipeline markiert erledigte, aktuelle und offene Phasen und schachtelt den Prüf-Workflow', () => {
  const job = snapshot.groups[0].jobs[1]
  assert.deepEqual(pipelineOf(job.workflow), {
    workflow: 'Coding',
    stages: [
      { id: 'understand', description: 'Collect the facts', status: 'done', next: false },
      { id: 'specify', description: 'Define the behavior', status: 'done', next: false },
      { id: 'plan', description: 'Agree a short plan', status: 'current', next: false },
      { id: 'implement', description: 'Implement the approved plan', status: 'pending', next: true }
    ],
    nested: {
      workflow: 'ResultCheck',
      stages: [
        { id: 'check', description: 'Compare results', status: 'current', next: false },
        { id: 'decide', description: 'Allow or block', status: 'pending', next: false }
      ],
      nested: null
    }
  })
  assert.equal(pipelineOf('none'), null)
  assert.equal(pipelineOf([]), null)
})

test('das HTML maskiert Titel und zeigt Liste und Pipeline des ausgewählten Jobs', () => {
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 110_000 })
  assert.ok(html.includes('Plugin &lt;bauen&gt;'), 'Titel nicht maskiert')
  assert.ok(!html.includes('<bauen>'))
  assert.ok(html.includes('data-key="a2"') && html.includes('data-key="b1"'))
  assert.ok(/class="job selected"[^>]*data-key="a2"/.test(html), 'Auswahl fehlt')
  assert.ok(html.includes('understand → specify → plan → implement'), 'Phasenfolge fehlt')
  assert.ok(/class="stage current"[^]*?plan/.test(html), 'aktuelle Phase fehlt')
  assert.ok(html.includes('ResultCheck'), 'Prüf-Workflow fehlt')
  assert.ok(html.includes('kaputt'), 'Fehler eines Workspaces fehlt')
  assert.ok(html.includes('working'))
})

test('ohne Jobs und bei einem Fehler zeigt das Panel einen Hinweis', () => {
  assert.ok(renderPanel({ snapshot: { sessionsDir: '/s', groups: [] }, selected: null, error: null, now: 0 }).includes('No agents'))
  assert.ok(renderPanel({ snapshot: null, selected: null, error: 'worker down', now: 0 }).includes('worker down'))
  assert.ok(renderPanel({ snapshot: null, selected: null, error: null, now: 0 }).includes('Loading'))
})

test('ein Job ohne aktiven Workflow zeigt statt einer Pipeline einen Hinweis', () => {
  const html = renderPanel({ snapshot, selected: 'a1', error: null, now: 0 })
  assert.ok(html.includes('has no Pi workflow'))
})
