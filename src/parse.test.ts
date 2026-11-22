// Prüft die Auswertung der Pi-Session-Datei: Workflow-Stapel aus den `workflow-state`-Einträgen.
// Die Zeilen folgen der Form echter Sessions unter ~/.pi/agent/sessions (gekürzt).
import { assert, test } from 'orca/testing'
import { parseWorkflowStack as parseFull, type WorkflowLevel } from './parse'

/** Die meisten Tests prüfen nur Workflow und Phase; die Phasenliste prüft ein eigener Test. */
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

test('ohne Workflow-Einträge ist der Stapel leer', () => {
  const text = [header, msg('a', null), msg('b', 'a')].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [])
})

test('aktivierter Workflow mit Übergang zeigt die letzte Phase der Route', () => {
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

test('push legt einen verschachtelten Workflow auf, exited nimmt ihn wieder ab', () => {
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

test('replace ersetzt den ganzen Stapel', () => {
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

test('nach exited des letzten Workflows ist der Stapel leer', () => {
  const text = [
    header,
    state('a', null, { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    state('b', 'a', { kind: 'exited' })
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [])
})

test('nur der aktuelle Zweig zählt (AK3)', () => {
  // c liegt auf einem verlassenen Zweig; der letzte Eintrag e hängt an b.
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

test('kaputte und leere Zeilen werden übersprungen (AK6)', () => {
  const text = [
    header,
    '{"type":"custom", kaputt',
    '',
    state('a', null, { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }),
    'nicht einmal JSON'
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [
    { workflow: 'Coding', stage: 'understand', stageNumber: 1, stageCount: 6 }
  ])
})

test('ein Übergang mit Prüf-Workflow wartet und greift erst bei exited mit allow: true', () => {
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

test('eine Phase, die der Workflow nicht kennt, hat keine Nummer', () => {
  const text = [
    header,
    state('a', null, { kind: 'activated', workflow: { id: 'Custom' }, route: ['x'], mode: 'replace' })
  ].join('\n')
  assert.deepEqual(parseWorkflowStack(text), [
    { workflow: 'Custom', stage: 'x', stageNumber: null, stageCount: null }
  ])
})

test('jede Ebene trägt die Phasen ihrer Definition mit Beschreibung', () => {
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
