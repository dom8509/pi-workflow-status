// Tests the HTML panel's view model: Activity list, selection and pipeline.
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
          title: 'Plugin <build>',
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
    { workspaceId: 'ws-c', name: 'broken', jobs: [], error: 'broken' }
  ]
}

test('the Activity list shows running jobs first, then the most recently changed', () => {
  assert.deepEqual(
    activityOf(snapshot).map((item) => [item.key, item.workspace, item.summary]),
    [
      ['a2', 'main', 'Coding · plan › ResultCheck · check'],
      ['b1', 'hearturchin', 'no active workflow'],
      ['a1', 'main', 'no workflow']
    ]
  )
})

test('without a valid selection the first job with an active workflow is selected', () => {
  const items = activityOf(snapshot)
  assert.equal(selectJob(items, null), 'a2')
  assert.equal(selectJob(items, 'does-not-exist'), 'a2')
  assert.equal(selectJob(items, 'b1'), 'b1')
  assert.equal(selectJob([], 'b1'), null)
})

test('the pipeline marks done, current and pending stages and nests the check workflow', () => {
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

test('the HTML escapes titles and shows the list and the selected job\'s pipeline', () => {
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 110_000, workflowsOnly: false })
  assert.ok(html.includes('Plugin &lt;build&gt;'), 'title not escaped')
  assert.ok(!html.includes('<build>'))
  assert.ok(html.includes('data-key="a2"') && html.includes('data-key="b1"'))
  assert.ok(/class="job selected"[^>]*data-key="a2"/.test(html), 'selection missing')
  assert.ok(html.includes('understand → specify → plan → implement'), 'stage sequence missing')
  assert.ok(/class="stage current"[^]*?plan/.test(html), 'current stage missing')
  assert.ok(html.includes('ResultCheck'), 'check workflow missing')
  assert.ok(html.includes('broken'), 'workspace error missing')
  assert.ok(html.includes('working'))
})

test('without jobs and on an error the panel shows a notice', () => {
  const none = renderPanel({ snapshot: { sessionsDir: '/s', groups: [] }, selected: null, error: null, now: 0, workflowsOnly: true })
  assert.ok(none.includes('No agents'))
  // Count and switch stay usable even without jobs.
  assert.ok(none.includes('<span class="count">0/0</span>'))
  assert.ok(none.includes('data-filter="workflows-only" checked'))
  assert.ok(renderPanel({ snapshot: null, selected: null, error: 'worker down', now: 0, workflowsOnly: false }).includes('worker down'))
  assert.ok(renderPanel({ snapshot: null, selected: null, error: null, now: 0, workflowsOnly: false }).includes('Loading'))
})

test('a job without an active workflow shows a notice instead of a pipeline', () => {
  const html = renderPanel({ snapshot, selected: 'a1', error: null, now: 0, workflowsOnly: false })
  assert.ok(html.includes('has no Pi workflow'))
})

test('a current stage outside the definition stays visible with its check workflow', () => {
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

test('a job with a workflow shows one chip per level, one without shows a grey notice', () => {
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 0, workflowsOnly: false })
  assert.ok(
    /<span class="chips"><span class="chip" style="--hue: 215">Coding · plan<\/span><span class="chip" style="--hue: 175">ResultCheck · check<\/span><\/span>/.test(html),
    'chips missing'
  )
  assert.ok(html.includes('<span class="no-workflow">no workflow</span>'))
  assert.ok(html.includes('<span class="no-workflow">no active workflow</span>'))
})

test('the filter hides jobs without an active workflow and counts visible jobs', () => {
  const items = activityOf(snapshot)
  assert.deepEqual(visibleItems(items, true).map((item) => item.key), ['a2'])
  assert.deepEqual(visibleItems(items, false).map((item) => item.key), ['a2', 'b1', 'a1'])
  const html = renderPanel({ snapshot, selected: 'b1', error: null, now: 0, workflowsOnly: true })
  assert.ok(html.includes('<span class="count">1/3</span>'), 'count missing')
  assert.ok(/<input type="checkbox" data-filter="workflows-only" checked>/.test(html), 'switch missing')
  assert.ok(!html.includes('data-key="b1"'), 'hidden job visible')
  assert.ok(/class="job selected"[^>]*data-key="a2"/.test(html), 'selection does not move to a visible job')
})

test('with no job running a workflow the panel says so and keeps the filter usable', () => {
  const idle: JobsSnapshot = { sessionsDir: '/s', groups: [snapshot.groups[1]] }
  const html = renderPanel({ snapshot: idle, selected: null, error: null, now: 0, workflowsOnly: true })
  assert.ok(html.includes('No job is running a workflow right now.'))
  assert.ok(html.includes('data-filter="workflows-only"'))
})

test('list and pipeline sit in their own scroll areas below fixed headings', () => {
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 0, workflowsOnly: false })
  assert.ok(/<section class="activity">\s*<header[^]*<\/header>\s*<ul class="jobs scroll">/.test(html), 'Activity area')
  assert.ok(/<section class="detail">\s*<header[^]*Coding[^]*<\/header>\s*<div class="scroll">/.test(html), 'pipeline area')
})

test('every workflow has a fixed colour: known ones from a table, others from the name', () => {
  assert.equal(workflowHue('Coding'), 215)
  assert.equal(workflowHue('Package'), 270)
  assert.equal(workflowHue('ResultCheck'), 175)
  const custom = workflowHue('MyCustomFlow')
  assert.equal(workflowHue('MyCustomFlow'), custom)
  assert.ok(Number.isInteger(custom) && custom >= 0 && custom < 360)
  assert.notEqual(workflowHue('MyCustomFlow'), workflowHue('OtherFlow'))
})

test('the pipeline heading carries the colour of its workflow', () => {
  const html = renderPanel({ snapshot, selected: 'a2', error: null, now: 0, workflowsOnly: false })
  assert.ok(html.includes('<h2 style="--hue: 215"><span class="hue-dot"></span>Coding</h2>'))
  assert.ok(html.includes('<h2 style="--hue: 175"><span class="hue-dot"></span>ResultCheck</h2>'))
})

test('names like object properties still yield a hue 0–359', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const hue = workflowHue(name)
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `${name} → ${String(hue)}`)
  }
})

test('remote jobs show their server name; unreadable ones say so', () => {
  const remote: JobsSnapshot = {
    sessionsDir: '/s',
    groups: [
      { workspaceId: 'env-1/ws', name: 'release', host: 'Mac mini', jobs: [{ key: 'env-1/r1', title: 'Ship', agent: 'pi', state: 'working', stateStartedAt: 1, workflow: snapshot.groups[0].jobs[1].workflow }] },
      { workspaceId: 'ssh-ws', name: 'box', host: 'ssh:box', jobs: [{ key: 'y', title: 'Box job', agent: 'claude', state: 'done', stateStartedAt: 0, workflow: 'remote' }] }
    ]
  }
  const html = renderPanel({ snapshot: remote, selected: null, error: null, now: 0, workflowsOnly: false })
  assert.ok(html.includes('<span class="host">Mac mini</span>'), 'server name missing')
  assert.ok(html.includes('<span class="no-workflow">workflow not readable</span>'))
  assert.ok(html.includes('title="Mac mini · release"'))
})
