import type { Props } from "../types/host.js"

/**
 * The host element types backed by the native text editor.
 *
 * These are the only types whose text lives in Rust rather than in a prop, so
 * they are the only ones with an editor to read, restore, or write: everything
 * that asks "does this element edit text?" — the ref accessors, the controlled
 * state restore, the value matchers — asks {@link isTextEditingInstance}.
 *
 * This list must track the Rust side. An element type answers
 * `text_editing_state` only by implementing it in `packages/native/src`, which
 * today means `custom_elements/input.rs` and its `input` and `textarea`
 * factories. Add a type here when, and only when, a new element implements it.
 */
export const TEXT_EDITING_TYPES: ReadonlySet<string> = new Set(["input", "textarea"])

/** The `<input>` types that are not text editors: see `inputKind` in `form-controls.ts`. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio", "hidden", "range"])

/**
 * Whether this host edits text: a `<textarea>`, or an `<input>` whose `type`
 * leaves it a text editor rather than a checkbox, radio, hidden, or range input.
 */
export function isTextEditingInstance(instance: { type: string; props: Props }): boolean {
  if (!TEXT_EDITING_TYPES.has(instance.type)) return false
  if (instance.type !== "input") return true
  const type = (instance.props as Props & { type?: unknown }).type
  return typeof type !== "string" || !NON_TEXT_INPUT_TYPES.has(type.toLowerCase())
}
