// Prüft das Speichern des Filters „Workflows only“: höchstens ein Schreibvorgang gleichzeitig,
// die Anzeige folgt immer dem zuletzt gewählten oder, nach einem Fehler, dem gespeicherten Wert.
import { assert, test } from 'orca/testing'
import { FilterStore } from './filter-store'

type Pending = { value: boolean; resolve: () => void; reject: (error: Error) => void }

function harness(initial: boolean) {
  const writes: Pending[] = []
  const persisted = { value: initial }
  const changes: { shown: boolean; error: string | null }[] = []
  const store = new FilterStore(
    initial,
    (value) =>
      new Promise<void>((resolve, reject) => {
        writes.push({
          value,
          resolve: () => {
            persisted.value = value
            resolve()
          },
          reject
        })
      }),
    (shown, error) => changes.push({ shown, error })
  )
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { store, writes, persisted, changes, settle }
}

test('schnelles Umschalten schreibt nacheinander und endet beim letzten Wert', async () => {
  const h = harness(true)
  h.store.choose(false)
  h.store.choose(true)
  h.store.choose(false)
  assert.equal(h.writes.length, 1, 'mehr als ein Schreibvorgang gleichzeitig')
  assert.equal(h.store.shown, false)
  h.writes[0].resolve()
  await h.settle()
  assert.equal(h.writes.length, 1, 'der letzte Wert entspricht schon dem gespeicherten')
  assert.equal(h.persisted.value, false)
  assert.equal(h.store.shown, false)
})

test('wechselt der Wunsch während des Schreibens, folgt ein zweiter Schreibvorgang', async () => {
  const h = harness(true)
  h.store.choose(false)
  h.store.choose(true)
  h.writes[0].resolve()
  await h.settle()
  assert.equal(h.writes.length, 2)
  assert.equal(h.writes[1].value, true)
  h.writes[1].resolve()
  await h.settle()
  assert.equal(h.persisted.value, true)
  assert.equal(h.store.shown, true)
  assert.equal(h.store.error, null)
})

test('schlägt der einzige Schreibvorgang fehl, zeigt die Anzeige den gespeicherten Wert und den Grund', async () => {
  const h = harness(true)
  h.store.choose(false)
  h.writes[0].reject(new Error('disk full'))
  await h.settle()
  assert.equal(h.store.shown, true)
  assert.equal(h.store.error, 'Could not save the filter: disk full')
})

test('erst Erfolg, dann Fehler: Anzeige und Speicher stimmen überein', async () => {
  const h = harness(true)
  h.store.choose(false)
  h.store.choose(true)
  h.writes[0].resolve()
  await h.settle()
  h.writes[1].reject(new Error('nope'))
  await h.settle()
  assert.equal(h.persisted.value, false)
  assert.equal(h.store.shown, false)
  assert.ok(h.store.error)
})

test('eine neue Wahl nach einem Fehler entfernt die Meldung, sobald sie gespeichert ist', async () => {
  const h = harness(true)
  h.store.choose(false)
  h.writes[0].reject(new Error('nope'))
  await h.settle()
  h.store.choose(false)
  h.writes[1].resolve()
  await h.settle()
  assert.equal(h.store.shown, false)
  assert.equal(h.store.error, null)
})

test('ein später geladener gespeicherter Wert gilt nur, solange niemand gewählt hat', () => {
  const h = harness(true)
  h.store.loaded(false)
  assert.equal(h.store.shown, false)
  h.store.choose(true)
  h.store.loaded(false)
  assert.equal(h.store.shown, true)
})
