// Prüft den Worker über `jobs.list` und `jobs.changed`, mit Orca als Mock und echten
// Session-Dateien in einem temporären Ordner.
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

/** Erwarteter Stapel für `inPlan`; die Fixture-Definition hat keine Beschreibungen. */
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

test('listet Pi- und andere Agenten pro Workspace mit Workflow-Zustand (AK1, AK2, AK4, AK7)', async () => {
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

test('nimmt eine sessionId, die ein Pfad im Sessions-Ordner ist, und lehnt Pfade außerhalb ab', async () => {
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

test('ohne passende sessionId nimmt der einzige Pi-Agent die neueste Session seines Workspaces', async () => {
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

test('zwei Pi-Agenten ohne passende sessionId im selben Workspace bleiben unknown', async () => {
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

test('ein Fehler eines Workspaces lässt die anderen stehen; leere Workspaces und andere Hosts fehlen (AK6)', async () => {
  const worker = await mountWorker(main, {
    host: host(
      {
        [WS_A]: hostError('action_failed', 'kaputt'),
        [WS_B]: [{ terminalId: 't2', title: 'B', agent: 'pi', state: 'waiting', stateStartedAt: 5, sessionId: 'fehlt' }]
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
    { workspaceId: WS_A, name: 'hearturchin', jobs: [], error: 'kaputt' },
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

test('meldet eine geänderte Session-Datei innerhalb von 2 s an das Panel (AK5)', async () => {
  const worker = await mountWorker(main, { host: host({}) })
  await worker.request('jobs.list')
  // macOS meldet Dateiereignisse über FSEvents erst, wenn der Watcher-Stream läuft; das dauert
  // nach dem Anlegen einige Millisekunden. Gemessen wird ab dem Schreiben bei laufendem Watcher.
  await new Promise((resolve) => setTimeout(resolve, 300))
  const started = Date.now()
  writeFileSync(join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`), inPlan)
  while (!worker.posts.some((post) => post.event === 'jobs.changed') && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(
    worker.posts.some((post) => post.event === 'jobs.changed'),
    `kein jobs.changed nach ${Date.now() - started} ms`
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

test('Titel kommen exakt über die sessionId aus der Session-Historie, auch bei zwei Pi-Agenten', async () => {
  const first = join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`)
  const second = join(root, DIR_A, '2026-11-22T12-07-03-618Z_01a20327-18c0-724f-81c5-bcacf59b20e3.jsonl')
  writeFileSync(first, inPlan)
  writeFileSync(second, session())
  // Die CLI kennt beide Pi-Agenten, kann sie aber nicht unterscheiden; sie darf nicht greifen.
  cliAgents = {
    agents: [
      { agent: 'pi', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Falsch 1' },
      { agent: 'pi', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Falsch 2' }
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
            // Orcas Historie nennt Pi-Sessions mit ihrer ID, agents.list mit dem Dateipfad.
            historySession('01a20327-18c0-724f-81c5-bcacf59b20e3', 'Designvorgaben definieren und laufend testen'),
            historySession(PI_ID, 'Orca-Plugin für Job-Workflow und Phase'),
            historySession('/anders.jsonl', 'Fremde Session')
          ]
        }
      }
    )
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(
    groups[0].jobs.map((job) => job.title),
    ['Orca-Plugin für Job-Workflow und Phase', 'Designvorgaben definieren und laufend testen']
  )
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('ohne Treffer in der Historie greift die CLI nur bei genau einem Agenten dieser Art im Workspace', async () => {
  cliAgents = {
    agents: [
      { agent: 'claude', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/BM-225', title: 'BM-225 (w3)' },
      { agent: 'claude', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Claude A' },
      { agent: 'claude', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Claude B' },
      { agent: 'pi', worktreeId: 'p::/Users/dom/orca/workspaces/breathing-mind/hearturchin', title: 'Einziger Pi' }
    ]
  }
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [
        { terminalId: null, title: null, agent: 'claude', state: 'done', stateStartedAt: 1, sessionId: null },
        { terminalId: null, title: null, agent: 'claude', state: 'done', stateStartedAt: 2, sessionId: null },
        { terminalId: null, title: null, agent: 'pi', state: 'done', stateStartedAt: 3, sessionId: 'nicht-in-historie' }
      ],
      [WS_B]: [{ terminalId: null, title: null, agent: 'claude', state: 'working', stateStartedAt: 4, sessionId: null }]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(
    groups.map((group) => group.jobs.map((job) => job.title)),
    [['claude', 'claude', 'Einziger Pi'], ['BM-225 (w3)']]
  )
  await worker.deactivate()
})

test('ein Ordner-Workspace wird in der CLI über seine ID gefunden', async () => {
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

test('fallen Historie und CLI aus, bleibt die Agent-Art als Name', async () => {
  cliAgents = new Error('orca nicht gefunden')
  const worker = await mountWorker(main, {
    host: host(
      { [WS_A]: [{ terminalId: null, title: null, agent: 'pi', state: 'done', stateStartedAt: 1, sessionId: 'x' }] },
      { sessions: { [WS_A]: hostError('action_failed', 'Historie kaputt') } }
    )
  })
  const { groups } = await worker.request('jobs.list')
  assert.equal(groups[0].jobs[0].title, 'pi')
  assert.equal(groups[0].error, undefined)
  await worker.deactivate()
})

test('eine Session-Datei, die als Symlink aus dem Sessions-Ordner hinauszeigt, wird nicht gelesen', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'ows-outside-'))
  const target = join(outsideDir, 'geheim.jsonl')
  writeFileSync(target, inPlan)
  const link = join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`)
  symlinkSync(target, link)
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [
        { terminalId: 't1', title: 'Per ID', agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: PI_ID },
        { terminalId: 't2', title: 'Per Pfad', agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: link }
      ]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.deepEqual(groups[0].jobs.map((job) => job.workflow), ['unknown', 'unknown'])
  rmSync(outsideDir, { recursive: true, force: true })
  await worker.deactivate()
})

test('eine hängende CLI verzögert jobs.list um höchstens 1,5 s und lässt die Agent-Art stehen (AK5)', async () => {
  setCliAgentsReader(() => new Promise(() => undefined))
  const worker = await mountWorker(main, {
    host: host({ [WS_A]: [{ terminalId: 't1', title: null, agent: 'claude', state: 'done', stateStartedAt: 1, sessionId: null }] })
  })
  const started = Date.now()
  const { groups } = await worker.request('jobs.list')
  const elapsed = Date.now() - started
  assert.ok(elapsed < 2000, `jobs.list dauerte ${elapsed} ms`)
  assert.equal(groups[0].jobs[0].title, 'claude')
  await worker.deactivate()
})

test('ein anfangs fehlender Sessions-Ordner wird beim nächsten jobs.list beobachtet (AK5)', async () => {
  const later = join(root, 'spaeter')
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
  assert.ok(worker.posts.some((post) => post.event === 'jobs.changed'), 'kein jobs.changed')
  await worker.deactivate()
})

async function waitForPost(worker: { posts: readonly { event: string }[] }, count: number, limitMs: number): Promise<number> {
  const started = Date.now()
  while (worker.posts.filter((post) => post.event === 'jobs.changed').length < count && Date.now() - started < limitMs) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return Date.now() - started
}

test('eine langsame Historie verzögert jobs.list nicht; ihr Titel kommt mit jobs.changed nach (AK5)', async () => {
  const path = join(root, DIR_A, `2026-11-22T11-41-28-639Z_${PI_ID}.jsonl`)
  writeFileSync(path, inPlan)
  const worker = await mountWorker(main, {
    host: host(
      { [WS_A]: [{ terminalId: null, title: null, agent: 'pi', state: 'working', stateStartedAt: 1, sessionId: path }] },
      { sessions: { [WS_A]: [historySession(PI_ID, 'Spät geladener Titel')] }, sessionsDelayMs: 900 }
    )
  })
  // `worker.request` wartet im Test-Kit, bis alle Host-Aufrufe erledigt sind; die Dauer ist hier
  // deshalb kein Maß. Dass die Antwort nicht auf die Historie gewartet hat, zeigt der Titel.
  const first = await worker.request('jobs.list')
  assert.equal(first.groups[0].jobs[0].title, 'pi')
  assert.deepEqual(first.groups[0].jobs[0].workflow, [PLAN])
  const before = worker.posts.filter((post) => post.event === 'jobs.changed').length
  await waitForPost(worker, before + 1, 2000)
  const second = await worker.request('jobs.list')
  assert.equal(second.groups[0].jobs[0].title, 'Spät geladener Titel')
  await worker.deactivate()
})

test('ein später angelegter Sessions-Ordner wird ohne weitere Anfrage beobachtet (AK5)', async () => {
  const later = join(root, 'spaeter-ohne-anfrage')
  const worker = await mountWorker(main, {
    host: mockHost({
      settings: { sessionsDir: later },
      results: { 'workspace.list': { workspaces: [], truncated: false } }
    })
  })
  await worker.request('jobs.list')
  mkdirSync(join(later, DIR_A), { recursive: true })
  // Sobald der Watcher steht, meldet der Worker das, damit das Panel Sessions aus der Lücke sieht.
  const elapsed = await waitForPost(worker, 1, 2000)
  assert.ok(worker.posts.some((post) => post.event === 'jobs.changed'), `kein jobs.changed nach ${elapsed} ms`)
  await worker.deactivate()
})

test('der Schlüssel eines Jobs ohne Terminal ist seine sessionId und bleibt stabil', async () => {
  const worker = await mountWorker(main, {
    host: host({
      [WS_A]: [{ terminalId: null, title: null, agent: 'claude', state: 'done', stateStartedAt: 1, sessionId: 'abc' }]
    })
  })
  const { groups } = await worker.request('jobs.list')
  assert.equal(groups[0].jobs[0].key, `${WS_A}#abc`)
  await worker.deactivate()
})
