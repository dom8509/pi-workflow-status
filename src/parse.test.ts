// Tests reading a Pi session file: the workflow stack from its `workflow-state` entries.
// The lines follow the shape of real sessions under ~/.pi/agent/sessions (shortened).
import { assert, test } from 'orca/testing'
import { parseWorkflowStack as parseFull, type WorkflowLevel } from './parse'

/** Most tests check only workflow and stage; a separate test checks the stage list. */
function parseWorkflowStack(text: string): Omit<WorkflowLevel, 'stages'>[] {
  return parseFull(text).map(({ stages: _stages, ...rest }) => rest)
}

const coding = {
  id: 'Coding',
  stages: [
    { id: 'understand' },
    { id: 'specify' },
    { id: 'plan' },
    { id: 'implement' },
    { id: 'verify' },
    { id: 'deliver' }
  ]
}
const resultCheck = { id: 'ResultCheck', stages: [{ id: 'check' }, { id: 'decide' }] }

function state(id: string, parentId: string | null, data: unknown): string {
  return JSON.stringify({ type: 'custom', customType: 'workflow-state', id, parentId, data })
}
function msg(id: string, parentId: string | null): string {
  return JSON.stringify({ type: 'message', id, parentId, message: { role: 'user', content: 'x' } })
}
const header = JSON.stringify({ type: 'session', version: 3, id: 'sess', cwd: '/tmp/x' })

test('without workflow entries the stack is empty', () => {
  const text = [header, msg('a', null), msg('b', 'a')].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [])
})

test('an activated workflow with a transition shows the last stage of its route', () => {
  const text = [
    header,
    msg('a', null),
    state('b', 'a', { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    state('c', 'b', { kind: 'transitioned', route: ['understand', 'specify'] }),
    state('d', 'c', { kind: 'transitioned', route: ['understand', 'specify', 'plan'] })
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [
    { workflow: 'Coding', stage: 'plan', stageNumber: 3, stageCount: 6 }
  ])
})

test('push adds a nested workflow, exited removes it again', () => {
  const base = [
    header,
    state('a', null, { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    state('b', 'a', { kind: 'transitioned', route: ['understand', 'specify', 'plan'] }),
    state('c', 'b', { kind: 'activated', workflow: resultCheck, route: ['check'], mode: 'push' })
  ]
  assert.deepEqual(parseWorkflowStack(base.join('\n')), [
    { workflow: 'Coding', stage: 'plan', stageNumber: 3, stageCount: 6 },
    { workflow: 'ResultCheck', stage: 'check', stageNumber: 1, stageCount: 2 }
  ])
  const exited = [...base, state('d', 'c', { kind: 'exited' })]
  assert.deepEqual(parseWorkflowStack(exited.join('\n')), [
    { workflow: 'Coding', stage: 'plan', stageNumber: 3, stageCount: 6 }
  ])
})

test('replace replaces the whole stack', () => {
  const text = [
    header,
    state('a', null, { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    state('b', 'a', { kind: 'activated', workflow: resultCheck, route: ['check'], mode: 'push' }),
    state('c', 'b', { kind: 'activated', workflow: { id: 'Analysis', stages: [{ id: 'scope' }] }, route: ['scope'], mode: 'replace' })
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [
    { workflow: 'Analysis', stage: 'scope', stageNumber: 1, stageCount: 1 }
  ])
})

test('after the last workflow exits the stack is empty', () => {
  const text = [
    header,
    state('a', null, { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    state('b', 'a', { kind: 'exited' })
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [])
})

test('only the current branch counts', () => {
  // c is on an abandoned branch; the last entry e hangs off b.
  const text = [
    header,
    state('a', null, { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    msg('b', 'a'),
    state('c', 'b', { kind: 'transitioned', route: ['understand', 'specify', 'plan', 'implement'] }),
    state('d', 'b', { kind: 'transitioned', route: ['understand', 'specify'] }),
    msg('e', 'd')
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [
    { workflow: 'Coding', stage: 'specify', stageNumber: 2, stageCount: 6 }
  ])
})

test('broken and empty lines are skipped', () => {
  const text = [
    header,
    '{"type":"custom", broken',
    '',
    state('a', null, { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    'not even JSON'
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [
    { workflow: 'Coding', stage: 'understand', stageNumber: 1, stageCount: 6 }
  ])
})

test('a transition through a check workflow waits and applies only on exited with allow: true', () => {
  const base = [
    header,
    state('a', null, { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    state('b', 'a', { kind: 'transitioned', route: ['understand', 'specify', 'plan'] }),
    state('c', 'b', {
      kind: 'activated',
      workflow: resultCheck,
      route: ['check'],
      mode: 'push',
      pendingTransition: { stageId: 'implement' }
    })
  ]
  assert.deepEqual(parseWorkflowStack(base.join('\n')), [
    { workflow: 'Coding', stage: 'plan', stageNumber: 3, stageCount: 6, pendingStage: 'implement' },
    { workflow: 'ResultCheck', stage: 'check', stageNumber: 1, stageCount: 2 }
  ])
  const allowed = [...base, state('d', 'c', { kind: 'exited', allow: true })]
  assert.deepEqual(parseWorkflowStack(allowed.join('\n')), [
    { workflow: 'Coding', stage: 'implement', stageNumber: 4, stageCount: 6 }
  ])
  const blocked = [...base, state('d', 'c', { kind: 'exited', allow: false })]
  assert.deepEqual(parseWorkflowStack(blocked.join('\n')), [
    { workflow: 'Coding', stage: 'plan', stageNumber: 3, stageCount: 6 }
  ])
})

test('a stage the workflow does not define has no number', () => {
  const text = [
    header,
    state('a', null, { kind: 'activated', workflow: { id: 'Custom' }, route: ['x'], mode: 'replace' })
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [
    { workflow: 'Custom', stage: 'x', stageNumber: null, stageCount: null }
  ])
})

test('each level carries the stages of its definition with descriptions', () => {
  const text = [
    header,
    state('a', null, {
      kind: 'activated',
      workflow: {
        id: 'Coding',
        stages: [
          { id: 'understand', description: 'Collect the facts of the task and the state of the project' },
          { id: 'plan', description: 'Agree a short plan with the user' },
          { id: 'odd' }
        ]
      },
      route: ['understand'],
      mode: 'replace'
    })
  ].join('\n')
  assert.deepEqual(parseFull(text)[0].stages, [
    { id: 'understand', description: 'Collect the facts of the task and the state of the project' },
    { id: 'plan', description: 'Agree a short plan with the user' },
    { id: 'odd', description: null }
  ])
})
