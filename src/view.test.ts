// Prüft das Ansichtsmodell des HTML-Panels: Activity-Liste, Auswahl und Pipeline.
import { assert, test } from 'orca/testing'
import type { JobsSnapshot } from './protocol'
import { activityOf, pipelineOf, renderPanel, selectJob, visibleItems, workflowHue } from './view'

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
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 110_000, workflowsOnly: false })
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
  const none = renderPanel({ snapshot: { sessionsDir: '/s', groups: [] }, selected: null, error: null, now: 0, workflowsOnly: true })
  assert.ok(none.includes('No agents'))
  // Auch ohne Jobs bleiben Zähler und Schalter bedienbar (AK9).
  assert.ok(none.includes('<span class="count">0/0</span>'))
  assert.ok(none.includes('data-filter="workflows-only" checked'))
  assert.ok(renderPanel({ snapshot: null, selected: null, error: 'worker down', now: 0, workflowsOnly: false }).includes('worker down'))
  assert.ok(renderPanel({ snapshot: null, selected: null, error: null, now: 0, workflowsOnly: false }).includes('Loading'))
})

test('ein Job ohne aktiven Workflow zeigt statt einer Pipeline einen Hinweis', () => {
  const html = renderPanel({ snapshot, selected: 'a1', error: null, now: 0, workflowsOnly: false })
  assert.ok(html.includes('has no Pi workflow'))
})

test('eine aktuelle Phase außerhalb der Definition bleibt mit ihrem Prüf-Workflow sichtbar', () => {
  const pipeline = pipelineOf([
    { workflow: 'Custom', stage: 'extra', stageNumber: null, stageCount: null, stages: [{ id: 'a', description: 'A' }] },
    { workflow: 'ResultCheck', stage: 'check', stageNumber: 1, stageCount: 1, stages: [{ id: 'check', description: null }] }
  ])
  assert.deepEqual(
    pipeline?.stages.map((stage) => [stage.id, stage.status]),
    [
      ['a', 'pending'],
      ['extra', 'current']
    ]
  )
  assert.equal(pipeline?.nested?.workflow, 'ResultCheck')
})

test('ein Job mit Workflow zeigt je Ebene einen Chip, einer ohne einen grauen Hinweis (AK8)', () => {
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 0, workflowsOnly: false })
  assert.ok(
    /<span class="chips"><span class="chip" style="--hue: 215">Coding · plan<\/span><span class="chip" style="--hue: 175">ResultCheck · check<\/span><\/span>/.test(html),
    'Chips fehlen'
  )
  assert.ok(html.includes('<span class="no-workflow">no workflow</span>'))
  assert.ok(html.includes('<span class="no-workflow">no active workflow</span>'))
})

test('der Filter blendet Jobs ohne aktiven Workflow aus und zählt sichtbare Jobs (AK9)', () => {
  const items = activityOf(snapshot)
  assert.deepEqual(visibleItems(items, true).map((item) => item.key), ['a2'])
  assert.deepEqual(visibleItems(items, false).map((item) => item.key), ['a2', 'b1', 'a1'])
  const html = renderPanel({ snapshot, selected: 'b1', error: null, now: 0, workflowsOnly: true })
  assert.ok(html.includes('<span class="count">1/3</span>'), 'Zähler fehlt')
  assert.ok(/<input type="checkbox" data-filter="workflows-only" checked>/.test(html), 'Schalter fehlt')
  assert.ok(!html.includes('data-key="b1"'), 'ausgeblendeter Job sichtbar')
  assert.ok(/class="job selected"[^>]*data-key="a2"/.test(html), 'Auswahl springt nicht auf sichtbaren Job')
})

test('ist kein Job mit Workflow übrig, nennt das Panel das und lässt den Filter bedienbar', () => {
  const idle: JobsSnapshot = { sessionsDir: '/s', groups: [snapshot.groups[1]] }
  const html = renderPanel({ snapshot: idle, selected: null, error: null, now: 0, workflowsOnly: true })
  assert.ok(html.includes('No job is running a workflow right now.'))
  assert.ok(html.includes('data-filter="workflows-only"'))
})

test('Liste und Pipeline liegen in eigenen Scrollbereichen unter festen Überschriften (AK10)', () => {
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 0, workflowsOnly: false })
  assert.ok(/<section class="activity">\s*<header[^]*<\/header>\s*<ul class="jobs scroll">/.test(html), 'Activity-Bereich')
  assert.ok(/<section class="detail">\s*<header[^]*Coding[^]*<\/header>\s*<div class="scroll">/.test(html), 'Pipeline-Bereich')
})

test('jeder Workflow hat eine feste Farbe: bekannte nach Tabelle, andere aus dem Namen (AK11)', () => {
  assert.equal(workflowHue('Coding'), 215)
  assert.equal(workflowHue('Package'), 270)
  assert.equal(workflowHue('ResultCheck'), 175)
  const custom = workflowHue('MyCustomFlow')
  assert.equal(workflowHue('MyCustomFlow'), custom)
  assert.ok(Number.isInteger(custom) && custom >= 0 && custom < 360)
  assert.notEqual(workflowHue('MyCustomFlow'), workflowHue('OtherFlow'))
})

test('die Pipeline-Überschrift trägt die Farbe ihres Workflows (AK11)', () => {
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 0, workflowsOnly: false })
  assert.ok(html.includes('<h2 style="--hue: 215"><span class="hue-dot"></span>Coding</h2>'))
  assert.ok(html.includes('<h2 style="--hue: 175"><span class="hue-dot"></span>ResultCheck</h2>'))
})

test('Namen wie Objekt-Eigenschaften ergeben trotzdem einen Farbton 0–359', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const hue = workflowHue(name)
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `${name} → ${String(hue)}`)
  }
})
