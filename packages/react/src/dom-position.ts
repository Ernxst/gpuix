/**
 * `Node.compareDocumentPosition()`'s bitmask, mirrored here because there is
 * no `Node` global on the native target. Values match the DOM constants.
 *
 * Deliberately zero-dependency: `host-config.ts` sits on a module cycle
 * (host-config -> event-registry -> reconciler -> host-config), and whichever
 * module first imports `host-config.ts` from outside that cycle can observe
 * `reconciler.ts`'s top-level `ReactReconciler(hostConfig)` call reading
 * `hostConfig` before it has finished initializing. Widely imported values
 * like these constants live here instead, where importing them can never
 * pull that cycle in as a side effect.
 */
export const DOCUMENT_POSITION_DISCONNECTED = 1
export const DOCUMENT_POSITION_PRECEDING = 2
export const DOCUMENT_POSITION_FOLLOWING = 4
export const DOCUMENT_POSITION_CONTAINS = 8
export const DOCUMENT_POSITION_CONTAINED_BY = 16
export const DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 32
