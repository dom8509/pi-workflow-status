// Tests the worker through `jobs.list` and `jobs.changed`, with a mocked Orca and real
// session files in a temporary folder.
import { afterEach, assert, beforeEach, hostError, mockHost, mountWorker, test } from 'orca/testing'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'
import { setCliAgentsReader } from './titles'

const PI_ID = '01a2030f-acbf-7611-ba03-9134156f5b2c'
const WS_A = 'proj::/Users/dom/orca/workspaces/breathing-mind/hearturchin'
const WS_B = 'proj::/Users/dom/orca/workspaces/breathing-mind/BM-225'
const DIR_A = '--Users-dom-orca-workspaces-breathing-mind-hearturchin--'
const DIR_B = '--Users-dom-orca-workspaces-breathing-mind-BM-225--'

const coding = {
  id: 'Coding',
  stages: [{ id: 'understand' }, { id: 'specify' }, { id: 'plan' }, { id: 'implement' }]
}

function session(...data: unknown[]): string {
  const lines = [JSON.stringify({ type: 'session', version: 3, id: 'x', cwd: '/x' })]
  let parent: string | null = null
  data.forEach((entry, index) => {
    const id = `e${index}`
    lines.push(JSON.stringify({ type: 'custom', customType: 'workflow-state', id, parentId: parent, data: entry }))
    parent = id
  })
  return lines.join('\n') + '\n'
}

/** Expected stack for `inPlan`; the fixture definition has no descriptions. */
const PLAN = {
  workflow: 'Coding',
  stage: 'plan',
  stageNumber: 3,
  stageCount: 4,
  stages: [
    { id: 'understand', description: null },
    { id: 'specify', description: null },
    { id: 'plan', description: null },
    { id: 'implement', description: null }
  ]
}

const inPlan = session(
  { kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' },
  { kind: 'transitioned', route: ['understand', 'specify', 'plan'] }
)

let root = ''

let cliAgents: unknown = { agents: [] }

beforeEach(() => {
  cliAgents = { agents: [] }
  setCliAgentsReader(async () => {
    if (cliAgents instanceof Error) throw cliAgents
    return cliAgents
  })
  root = mkdtempSync(join(tmpdir(), 'ows-test-'))
  mkdirSync(join(root, DIR_A))
  mkdirSync(join(root, DIR_B))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

type AgentRow = {
  terminalId: string | null
  title: string | null
  agent: string | null
  state: 'working' | 'blocked' | 'waiting' | 'done'
  stateStartedAt: number
  sessionId?: string | null
}

function host(
  agentsByWorkspace: Record<string, AgentRow[] | Error>,
  extra: {
    workspaces?: unknown[]
    sessions?: Record<string, unknown[] | Error>
    sessionsDelayMs?: number
  } = {}
) {
  return mockHost({
    settings: { sessionsDir: root },
    results: {
      'agent.listSessions': async (params: { workspaceId?: string }) => {
        if (extra.sessionsDelayMs) await new Promise((resolve) => setTimeout(resolve, extra.sessionsDelayMs))
        const answer = extra.sessions?.[params.workspaceId ?? ''] ?? []
        if (answer instanceof Error) throw answer
        return { sessions: answer, truncated: false }
      },
      'workspace.list': {
        workspaces: extra.workspaces ?? [
          { id: WS_A, kind: 'worktree', name: 'hearturchin', path: '/Users/dom/orca/workspaces/breathing-mind/hearturchin', branch: 'main', hostId: 'local' },
          { id: WS_B, kind: 'worktree', name: 'BM-225', path: '/Users/dom/orca/workspaces/breathing-mind/BM-225', branch: 'BM-225', hostId: 'local' }
        ],
        truncated: false
      },
      'agents.list': (params: { workspaceId?: string }) => {
        const answer = agentsByWorkspace[params.workspaceId ?? '']
        if (answer instanceof Error) throw answer
        return { agents: answer ?? [] }
      }
    }
  })
}

test('lists Pi and other agents per workspace with their workflow state', async () => {
  writeFileSync(join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`), inPlan)
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [{ terminalId: 't1', title: 'Coordinator', agent: 'pi', state: 'working', stateStartedAt: 1000, sessionId: PI_ID }],
      [WS_B]: [{ terminalId: 't2', title: 'BM-225 (w3)', agent: 'claude', state: 'done', stateStartedAt: 2000, sessionId: 'c7e4972d' }]
    })
  })
  const snapshot = await worker.request('jobs.list')
  assert.equal(snapshot.sessionsDir, root)
  assert.deepEqual(snapshot.groups, [
    {
      workspaceId: WS_A,
      name: 'hearturchin',
      jobs: [
        {
          key: 't1',
          title: 'Coordinator',
          agent: 'pi',
          state: 'working',
          stateStartedAt: 1000,
          workflow: [PLAN]
        }
      ]
    },
    {
      workspaceId: WS_B,
      name: 'BM-225',
      jobs: [{ key: 't2', title: 'BM-225 (w3)', agent: 'claude', state: 'done', stateStartedAt: 2000, workflow: 'none' }]
    }
  ])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('accepts a sessionId that is a path in the sessions folder and refuses paths outside', async () => {
  const inside = join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`)
  writeFileSync(inside, inPlan)
  const outsideDir = mkdtempSync(join(tmpdir(), 'ows-outside-'))
  const outside = join(outsideDir, 'x.jsonl')
  writeFileSync(outside, inPlan)
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [
        { terminalId: 't1', title: 'A', agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: inside },
        { terminalId: 't2', title: 'B', agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: outside }
      ]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(
    groups[0].jobs.map((job) => [job.key, job.workflow]),
    [
      ['t1', [PLAN]],
      ['t2', 'unknown']
    ]
  )
  rmSync(outsideDir, { recursive: true, force: true })
  await worker.deactivate()
})

test('without a matching sessionId the only Pi agent takes the newest session of its workspace', async () => {
  const older = join(root, DIR_A, '2026-11-21T08-00-00-000Z_aaaa.jsonl')
  const newer = join(root, DIR_A, '2026-11-22T08-00-00-000Z_bbbb.jsonl')
  writeFileSync(older, session({ kind: 'activated', workflow: coding, route: ['understand'], mode: 'replace' }))
  writeFileSync(newer, inPlan)
  utimesSync(older, 1000, 1000)
  utimesSync(newer, 2000, 2000)
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [
        { terminalId: 't1', title: 'A', agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: 'orca-id-unbekannt' },
        { terminalId: 't9', title: 'Claude', agent: 'claude', state: 'done', stateStartedAt: 1 }
      ]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(groups[0].jobs[0].workflow, [PLAN])
  await worker.deactivate()
})

test('two Pi agents without a matching sessionId in one workspace stay unknown', async () => {
  writeFileSync(join(root, DIR_A, '2026-11-22T08-00-00-000Z_bbbb.jsonl'), inPlan)
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [
        { terminalId: 't1', title: 'A', agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: null },
        { terminalId: 't2', title: 'B', agent: 'pi', state: 'working', stateStartedAt: 1 }
      ]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(groups[0].jobs.map((job) => job.workflow), ['unknown', 'unknown'])
  await worker.deactivate()
})

test('an error in one workspace leaves the others; empty workspaces and other hosts are left out', async () => {
  const worker = await mountWorker(main, {
    host: host(
      {
        [WS_A]: hostError('action_failed', 'broken'),
        [WS_B]: [{ terminalId: 't2', title: 'B', agent: 'pi', state: 'waiting', stateStartedAt: 5, sessionId: 'missing' }]
      },
      {
        workspaces: [
          { id: WS_A, kind: 'worktree', name: 'hearturchin', path: '/Users/dom/orca/workspaces/breathing-mind/hearturchin', branch: 'main', hostId: 'local' },
          { id: WS_B, kind: 'worktree', name: 'BM-225', path: '/Users/dom/orca/workspaces/breathing-mind/BM-225', branch: 'x', hostId: 'local' },
          { id: 'leer', kind: 'folder', name: 'leer', path: '/tmp/leer', branch: null, hostId: null },
          { id: 'remote', kind: 'worktree', name: 'remote', path: '/srv/x', branch: 'main', hostId: 'ssh:box' }
        ]
      }
    )
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(groups, [
    { workspaceId: WS_A, name: 'hearturchin', jobs: [], error: 'broken' },
    {
      workspaceId: WS_B,
      name: 'BM-225',
      jobs: [{ key: 't2', title: 'B', agent: 'pi', state: 'waiting', stateStartedAt: 5, workflow: 'unknown' }]
    }
  ])
  assert.deepEqual(
    worker.host.calls.filter((call) => call.method === 'agents.list').map((call) => (call.params as { workspaceId: string }).workspaceId),
    [WS_A, WS_B, 'leer']
  )
  await worker.deactivate()
})

test('reports a changed session file to the panel within 2 s', async () => {
  const worker = await mountWorker(main, { host: host({}) })
  await worker.request('jobs.list')
  // macOS reports file events through FSEvents only once the watcher stream runs, a few
  // milliseconds after it is created. The time is measured from the write with a running watcher.
  await new Promise((resolve) => setTimeout(resolve, 300))
  const started = Date.now()
  writeFileSync(join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`), inPlan)
  while (!worker.posts.some((post) => post.event === 'jobs.changed') && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(
    worker.posts.some((post) => post.event === 'jobs.changed'),
    `no jobs.changed after ${Date.now() - started} ms`
  )
  await worker.deactivate()
})

function historySession(sessionId: string, title: string, agent = 'pi') {
  return {
    sessionId,
    agent,
    title,
    workspaceId: WS_A,
    hostId: 'local',
    branch: 'main',
    createdAt: 1,
    updatedAt: 2,
    messageCount: 3,
    totalTokens: 4,
    running: true
  }
}

test('titles come exactly from the session history by sessionId, even with two Pi agents', async () => {
  const first = join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`)
  const second = join(root, DIR_A, '2026-11-22T12-07-03-618Z_01a20327-18c0-724f-81c5-bcacf59b20e3.jsonl')
  writeFileSync(first, inPlan)
  writeFileSync(second, session())
  // The CLI knows both Pi agents but cannot tell them apart, so it must not be used.
  cliAgents = {
    agents: [
      { agent: 'pi', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Wrong 1' },
      { agent: 'pi', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Wrong 2' }
    ]
  }
  const worker = await mountWorker(main, {
    host: host(
      {
        [WS_A]: [
          { terminalId: null, title: null, agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: first },
          { terminalId: null, title: null, agent: 'pi', state: 'done', stateStartedAt: 2, sessionId: second }
        ]
      },
      {
        sessions: {
          [WS_A]: [
            // Orca's history names Pi sessions by id, agents.list by file path.
            historySession('01a20327-18c0-724f-81c5-bcacf59b20e3', 'Define design rules and keep testing'),
            historySession(PI_ID, 'Orca plugin for job workflow and stage'),
            historySession('/other.jsonl', 'Unrelated session')
          ]
        }
      }
    )
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(
    groups[0].jobs.map((job) => job.title),
    ['Orca plugin for job workflow and stage', 'Define design rules and keep testing']
  )
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('without a history match the CLI applies only with exactly one agent of that kind in the workspace', async () => {
  cliAgents = {
    agents: [
      { agent: 'claude', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/BM-225', title: 'BM-225 (w3)' },
      { agent: 'claude', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Claude A' },
      { agent: 'claude', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Claude B' },
      { agent: 'pi', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Only pi' }
    ]
  }
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [
        { terminalId: null, title: null, agent: 'claude', state: 'done', stateStartedAt: 1, sessionId: null },
        { terminalId: null, title: null, agent: 'claude', state: 'done', stateStartedAt: 2, sessionId: null },
        { terminalId: null, title: null, agent: 'pi', state: 'done', stateStartedAt: 3, sessionId: 'not-in-history' }
      ],
      [WS_B]: [{ terminalId: null, title: null, agent: 'claude', state: 'working', stateStartedAt: 4, sessionId: null }]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(
    groups.map((group) => group.jobs.map((job) => job.title)),
    [['claude', 'claude', 'Only pi'], ['BM-225 (w3)']]
  )
  await worker.deactivate()
})

test('a folder workspace is found in the CLI by its id', async () => {
  cliAgents = { agents: [{ agent: 'claude', worktreeId: 'folder:abc', title: 'Security check' }] }
  const worker = await mountWorker(main, {
    host: host(
      { 'folder:abc': [{ terminalId: null, title: null, agent: 'claude', state: 'done', stateStartedAt: 1, sessionId: null }] },
      { workspaces: [{ id: 'folder:abc', kind: 'folder', name: 'Security check', path: '/Users/dom/.orca/bots/security-check', branch: null, hostId: null }] }
    )
  })
  const { groups } = await worker.request('jobs.list')
  assert.equal(groups[0].jobs[0].title, 'Security check')
  await worker.deactivate()
})

test('when history and CLI fail the agent kind stays as the name', async () => {
  cliAgents = new Error('orca not found')
  const worker = await mountWorker(main, {
    host: host(
      { [WS_A]: [{ terminalId: null, title: null, agent: 'pi', state: 'done', stateStartedAt: 1, sessionId: 'x' }] },
      { sessions: { [WS_A]: hostError('action_failed', 'history broken') } }
    )
  })
  const { groups } = await worker.request('jobs.list')
  assert.equal(groups[0].jobs[0].title, 'pi')
  assert.equal(groups[0].error, undefined)
  await worker.deactivate()
})

test('a session file that is a symlink out of the sessions folder is not read', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'ows-outside-'))
  const target = join(outsideDir, 'secret.jsonl')
  writeFileSync(target, inPlan)
  const link = join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`)
  symlinkSync(target, link)
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [
        { terminalId: 't1', title: 'By id', agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: PI_ID },
        { terminalId: 't2', title: 'By path', agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: link }
      ]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(groups[0].jobs.map((job) => job.workflow), ['unknown', 'unknown'])
  rmSync(outsideDir, { recursive: true, force: true })
  await worker.deactivate()
})

test('a hanging CLI delays jobs.list by at most 1.5 s and keeps the agent kind', async () => {
  setCliAgentsReader(() => new Promise(() => undefined))
  const worker = await mountWorker(main, {
    host: host({ [WS_A]: [{ terminalId: 't1', title: null, agent: 'claude', state: 'done', stateStartedAt: 1, sessionId: null }] })
  })
  const started = Date.now()
  const { groups } = await worker.request('jobs.list')
  const elapsed = Date.now() - started
  assert.ok(elapsed < 2000, `jobs.list took ${elapsed} ms`)
  assert.equal(groups[0].jobs[0].title, 'claude')
  await worker.deactivate()
})

test('a sessions folder missing at first is watched on the next jobs.list', async () => {
  const later = join(root, 'later')
  const worker = await mountWorker(main, {
    host: mockHost({
      settings: { sessionsDir: later },
      results: { 'workspace.list': { workspaces: [], truncated: false } }
    })
  })
  await worker.request('jobs.list')
  mkdirSync(join(later, DIR_A), { recursive: true })
  await worker.request('jobs.list')
  await new Promise((resolve) => setTimeout(resolve, 300))
  const started = Date.now()
  writeFileSync(join(later, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`), inPlan)
  while (!worker.posts.some((post) => post.event === 'jobs.changed') && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(worker.posts.some((post) => post.event === 'jobs.changed'), 'no jobs.changed')
  await worker.deactivate()
})

async function waitForPost(worker: { posts: readonly { event: string }[] }, count: number, limitMs: number): Promise<number> {
  const started = Date.now()
  while (worker.posts.filter((post) => post.event === 'jobs.changed').length < count && Date.now() - started < limitMs) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return Date.now() - started
}

test('a slow history does not delay jobs.list; its title follows with jobs.changed', async () => {
  const path = join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`)
  writeFileSync(path, inPlan)
  const worker = await mountWorker(main, {
    host: host(
      { [WS_A]: [{ terminalId: null, title: null, agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: path }] },
      { sessions: { [WS_A]: [historySession(PI_ID, 'Late title')] }, sessionsDelayMs: 900 }
    )
  })
  // In the test kit `worker.request` waits until all host calls are done, so its duration says
  // nothing here. The title shows that the answer did not wait for the history.
  const first = await worker.request('jobs.list')
  assert.equal(first.groups[0].jobs[0].title, 'pi')
  assert.deepEqual(first.groups[0].jobs[0].workflow, [PLAN])
  const before = worker.posts.filter((post) => post.event === 'jobs.changed').length
  await waitForPost(worker, before + 1, 2000)
  const second = await worker.request('jobs.list')
  assert.equal(second.groups[0].jobs[0].title, 'Late title')
  await worker.deactivate()
})

test('a sessions folder created later is watched without another request', async () => {
  const later = join(root, 'later-without-request')
  const worker = await mountWorker(main, {
    host: mockHost({
      settings: { sessionsDir: later },
      results: { 'workspace.list': { workspaces: [], truncated: false } }
    })
  })
  await worker.request('jobs.list')
  mkdirSync(join(later, DIR_A), { recursive: true })
  // Once the watcher runs the worker reports it, so the panel sees sessions from the gap.
  const elapsed = await waitForPost(worker, 1, 2000)
  assert.ok(worker.posts.some((post) => post.event === 'jobs.changed'), `no jobs.changed after ${elapsed} ms`)
  await worker.deactivate()
})

test('the key of a job without a terminal is its sessionId and stays stable', async () => {
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [{ terminalId: null, title: null, agent: 'claude', state: 'done', stateStartedAt: 1, sessionId: 'abc' }]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.equal(groups[0].jobs[0].key, `${WS_A}#abc`)
  await worker.deactivate()
})
