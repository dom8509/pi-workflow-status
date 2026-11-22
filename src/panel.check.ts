// `orca plugin check` zeichnet das Panel einmal pro Szenario, mit dem echten Worker auf einem
// Mock-Host. Der Sessions-Ordner zeigt ins Leere, damit check keine echten Sessions liest.
import { defineCheck } from 'orca/testing'

const workspaces = {
  workspaces: [
    { id: 'ws-a', kind: 'worktree', name: 'hearturchin', path: '/nowhere/hearturchin', branch: 'main', hostId: 'local' },
    { id: 'ws-b', kind: 'worktree', name: 'BM-225', path: '/nowhere/BM-225', branch: 'BM-225', hostId: 'local' }
  ],
  truncated: false
}

export default defineCheck({
  empty: {
    settings: { sessionsDir: '/nowhere/sessions' },
    results: { 'workspace.list': workspaces, 'agents.list': { agents: [] } }
  },
  agents: {
    settings: { sessionsDir: '/nowhere/sessions' },
    results: {
      'workspace.list': workspaces,
      'agents.list': (params: { workspaceId?: string }) => ({
        agents:
          params.workspaceId === 'ws-a'
            ? [{ terminalId: 't1', title: 'Coordinator', agent: 'pi', state: 'working', stateStartedAt: Date.now() - 60000, sessionId: 'missing' }]
            : [{ terminalId: 't2', title: 'BM-225 (w3)', agent: 'claude', state: 'done', stateStartedAt: Date.now() - 600000 }]
      })
    }
  }
})
