// Prüft, wie der Worker Pfade zu Pi-Sessions bildet.
import { assert, test } from 'orca/testing'
import { homedir } from 'node:os'
import { expandHome, sessionDirName } from './sessions'

test('~ am Anfang steht für das Home-Verzeichnis (AK7)', () => {
  assert.equal(expandHome('~/.pi/agent/sessions'), `${homedir()}/.pi/agent/sessions`)
  assert.equal(expandHome('~'), homedir())
  assert.equal(expandHome('/srv/pi/sessions'), '/srv/pi/sessions')
  assert.equal(expandHome('  /srv/pi  '), '/srv/pi')
})

test('der Ordnername einer Session folgt dem Arbeitsverzeichnis wie bei Pi', () => {
  // Echte Ordner unter ~/.pi/agent/sessions.
  assert.equal(sessionDirName('/Users/dom/Claude Projects/breathing-mind'), '--Users-dom-Claude Projects-breathing-mind--')
  assert.equal(sessionDirName('/Users/dom/.config/rex'), '--Users-dom-.config-rex--')
  assert.equal(sessionDirName('/Users/dom'), '--Users-dom--')
})
