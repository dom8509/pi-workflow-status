// Tests saving the "Workflows only" filter: at most one write at a time, and the panel always
// shows the latest choice or, after a failure, the saved value.
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

test('rapid toggling writes one after another and ends at the latest value', async () => {
  const h = harness(true)
  h.store.choose(false)
  h.store.choose(true)
  h.store.choose(false)
  assert.equal(h.writes.length, 1, 'more than one write at a time')
  assert.equal(h.store.shown, false)
  h.writes[0].resolve()
  await h.settle()
  assert.equal(h.writes.length, 1, 'the latest value already equals the saved one')
  assert.equal(h.persisted.value, false)
  assert.equal(h.store.shown, false)
})

test('a choice changed during a write triggers a second write', async () => {
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

test('a failed write shows the saved value and the reason', async () => {
  const h = harness(true)
  h.store.choose(false)
  h.writes[0].reject(new Error('disk full'))
  await h.settle()
  assert.equal(h.store.shown, true)
  assert.equal(h.store.error, 'Could not save the filter: disk full')
})

test('success then failure: display and storage agree', async () => {
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

test('a new choice after a failure clears the message once it is saved', async () => {
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

test('a stored value loaded late applies only while nobody has chosen', () => {
  const h = harness(true)
  h.store.loaded(false)
  assert.equal(h.store.shown, false)
  h.store.choose(true)
  h.store.loaded(false)
  assert.equal(h.store.shown, true)
})
