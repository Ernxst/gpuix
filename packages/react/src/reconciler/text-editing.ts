/**
 * The host element types backed by the native text editor.
 *
 * These are the only types whose text lives in Rust rather than in a prop, so
 * they are the only ones with an editor to read, restore, or write: everything
 * that asks "does this element edit text?" — the ref accessors, the controlled
 * state restore, the value matchers — asks it here.
 *
 * This list must track the Rust side. An element type answers
 * `text_editing_state` only by implementing it in `packages/native/src`, which
 * today means `custom_elements/input.rs` and its `input` and `textarea`
 * factories. Add a type here when, and only when, a new element implements it.
 */
export const TEXT_EDITING_TYPES: ReadonlySet<string> = new Set(["input", "textarea"])
