// Tests how the worker builds paths to Pi sessions.
import { assert, test } from 'orca/testing'
import { homedir } from 'node:os'
import { expandHome, sessionDirName } from './sessions'

test('a leading ~ stands for the home folder', () => {
  assert.equal(expandHome('~/.pi/agent/sessions'), `${homedir()}/.pi/agent/sessions`)
  assert.equal(expandHome('~'), homedir())
  assert.equal(expandHome('/srv/pi/sessions'), '/srv/pi/sessions')
  assert.equal(expandHome('  /srv/pi  '), '/srv/pi')
})

test('the session folder name follows the working directory as in Pi', () => {
  // Real folders under ~/.pi/agent/sessions.
  assert.equal(sessionDirName('/Users/dom/Claude Projects/breathing-mind'), '--Users-dom-Claude Projects-breathing-mind--')
  assert.equal(sessionDirName('/Users/dom/.config/rex'), '--Users-dom-.config-rex--')
  assert.equal(sessionDirName('/Users/dom'), '--Users-dom--')
})
