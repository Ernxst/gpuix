import { latestAttachedContainer } from "./reconciler/event-registry.js"
import type {
  AnnouncePoliteness,
  AnnouncerRegionPair,
  Container,
} from "./types/host.js"

export interface AnnounceOptions {
  /** @default "polite" */
  politeness?: AnnouncePoliteness
}

const ROLE_FOR_POLITENESS: Record<AnnouncePoliteness, "status" | "alert"> = {
  polite: "status",
  assertive: "alert",
}

function nextId(container: Container): number {
  return ++container.ids.nextElementId
}

/**
 * Build one politeness's alternating region pair and hang both under the
 * current root element. Each region is a visually hidden `role="status"` or
 * `role="alert"` div with one empty `<text>` child — the same shape
 * `<div role="status" ariaAtomic visuallyHidden><text /></div>` would
 * materialize to, sent by hand because these elements never exist in the
 * React tree for the reconciler to create.
 */
function createRegionPair(
  container: Container,
  politeness: AnnouncePoliteness,
  rootElementId: number
): AnnouncerRegionPair {
  const role = ROLE_FOR_POLITENESS[politeness]
  const regionIds: [number, number] = [nextId(container), nextId(container)]
  const textIds: [number, number] = [nextId(container), nextId(container)]
  const { renderer } = container

  for (let index = 0; index < 2; index += 1) {
    const regionId = regionIds[index]!
    const textId = textIds[index]!
    renderer.createElement(regionId, "div")
    renderer.setCustomProp(regionId, "role", role)
    renderer.setCustomProp(regionId, "ariaAtomic", true)
    renderer.setCustomProp(regionId, "visuallyHidden", true)
    renderer.createElement(textId, "text")
    renderer.setText(textId, "")
    renderer.appendChild(regionId, textId)
    renderer.appendChild(rootElementId, regionId)
  }

  return { regionIds, textIds, next: 0, attachedToRootId: rootElementId }
}

/**
 * Speak `message` to assistive technology without moving focus, through a
 * hidden `role="status"` (`politeness: "polite"`, the default) or
 * `role="alert"` (`"assertive"`) live region.
 *
 * Targets the most recently rendered root — the one `render()` mounted, or the
 * newest `createTestRoot()` that has rendered — so there is one region pair
 * per window, not per component. Two regions alternate per politeness: each
 * call clears whichever region it did not just write to, so AccessKit's frame
 * diff always sees a changed value, even for the same string announced twice
 * in a row.
 *
 * A no-op, with one `console.warn`, when no root is attached.
 */
export function announce(message: string, options: AnnounceOptions = {}): void {
  const politeness = options.politeness ?? "polite"
  const container = latestAttachedContainer()
  if (!container || container.rootElementId == null) {
    console.warn(
      `[gpuix] announce() called with no attached window; the message was dropped: ${JSON.stringify(message)}`
    )
    return
  }

  const rootElementId = container.rootElementId
  // `rootElementId` names an element the regions can be appended to, but only
  // a plain div (built-ins and the HTML-alias types that materialize as one)
  // accepts an arbitrary extra child. A bare `<text>` root or a `<virtual-list>`
  // root — whose children are its rows, not free-form content — cannot host
  // them, so warn instead of sending a mutation the native side would reject.
  if (container.rootElementType !== "div") {
    console.warn(
      `[gpuix] announce() cannot attach a live region to this window's root element ` +
        `(type "${container.rootElementType}"); the message was dropped: ${JSON.stringify(message)}. ` +
        "Render at least one plain host element (a <div> or an HTML-alias tag) at the top of the tree."
    )
    return
  }

  const { renderer } = container
  let pair = container.announcer[politeness]
  if (!pair || pair.attachedToRootId !== rootElementId) {
    // A stale pair's native elements were already destroyed with the root
    // element they hung off — the reconciler cascades `destroyElement` over a
    // removed subtree — so there is nothing to tear down here, only to
    // rebuild under the new root.
    pair = createRegionPair(container, politeness, rootElementId)
    container.announcer[politeness] = pair
  }

  const writeIndex = pair.next
  const clearIndex = writeIndex === 0 ? 1 : 0
  renderer.setText(pair.textIds[clearIndex], "")
  renderer.setText(pair.textIds[writeIndex], message)
  pair.next = clearIndex

  // Safe to call outside a React commit: this queues no work of React's, only
  // this module's own mutations, so it can flush them immediately rather than
  // waiting for `resetAfterCommit`. The one case worth knowing: calling
  // `announce()` from a layout-effect cleanup runs *during* a commit, and this
  // flush then sends whatever prefix of React's own batched mutations queued
  // ahead of it — still correct (Rust receives an ordered mutation stream
  // either way), just earlier than that commit's normal flush point. Documented
  // here rather than special-cased, since splitting the queue would only move
  // the same mutations to a different `applyBatch` call.
  renderer.flushMutations()
}
