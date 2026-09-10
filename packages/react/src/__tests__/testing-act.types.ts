import { act } from "../testing.js"

// A bare, synchronous scope typechecks with no `await` — the whole point of
// `act`'s `Promise<T> | T` return type over a plain `Promise<T>`.
act(() => {
  /* synchronous work */
})

const syncValue: number | Promise<number> = act(() => 1)
void syncValue

// An asynchronous scope typechecks awaited, resolving to the scope's value.
async function awaitsAsyncScope(): Promise<void> {
  await act(async () => {
    /* asynchronous work */
  })

  const asyncValue: number = await act(async () => 1)
  void asyncValue
}
void awaitsAsyncScope

// `act`'s return type is a union, `Promise<T> | T` — awaiting a bare,
// synchronous scope's result is legal too, since a non-promise is a valid
// operand of `await`.
async function awaitsSyncScope(): Promise<void> {
  const awaited: number = await act(() => 1)
  void awaited
}
void awaitsSyncScope
