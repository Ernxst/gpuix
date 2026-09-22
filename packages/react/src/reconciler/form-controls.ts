/**
 * Choice and range inputs, form ownership, reset, and submission.
 *
 * An `<input type="checkbox">` or `<input type="radio">` has no text for Rust
 * to own, so its state lives here, in the shape HTML gives it: a checkedness,
 * a dirty flag that stops the default from overwriting a user's choice, the
 * default itself, and the checkbox-only `indeterminate` flag. React props feed
 * that state the way ReactDOM's `updateInput` feeds a DOM input, and every
 * change is pushed to the retained tree as the internal `checked` and
 * `indeterminate` props. Rust reads those for painting, the accessibility
 * tree, and radio-group tab stops; the authored `checked`, `defaultChecked`
 * and `indeterminate` props never reach it.
 *
 * An `<input type="range">` is the same arrangement for a number: its
 * sanitized value lives here and reaches Rust as the internal `value` prop,
 * in place of the authored `value` and `defaultValue`.
 */

import type { Container, Instance, Props } from "../types/host.js"
import type { GpuixEventDispatchResult } from "./synthetic-event.js"
import { dispatchSyntheticEvent } from "./event-registry.js"
import { editorPropText } from "./text-editing.js"

export type InputKind = "text" | "checkbox" | "radio" | "hidden" | "range"

/**
 * The input kind an `<input>`'s `type` selects. Every type this renderer does
 * not implement falls back to the text editor, as an unknown `type` falls back
 * to `text` in HTML. Rust's `input_kind` must agree.
 */
export function inputKind(props: Props): InputKind {
  const type = (props as Props & { type?: unknown }).type
  if (typeof type !== "string") return "text"
  const lowered = type.toLowerCase()
  return lowered === "checkbox" ||
    lowered === "radio" ||
    lowered === "hidden" ||
    lowered === "range"
    ? lowered
    : "text"
}

export function isChoiceInput(instance: Instance): boolean {
  if (instance.type !== "input") return false
  const kind = inputKind(instance.props)
  return kind === "checkbox" || kind === "radio"
}

function isRadio(instance: Instance): boolean {
  return instance.type === "input" && inputKind(instance.props) === "radio"
}

function isDisabled(instance: Instance): boolean {
  const { disabled } = instance.props
  return disabled === true || typeof disabled === "string"
}

// ── Choice state ─────────────────────────────────────────────────────

interface ChoiceState {
  checked: boolean
  /** HTML's dirty checkedness flag: once set, the default no longer drives `checked`. */
  dirty: boolean
  defaultChecked: boolean
  indeterminate: boolean
  /** The values last written to the retained tree; `null` means removed. */
  sentChecked: boolean | null
  sentIndeterminate: boolean | null
}

/** Writes one internal prop to the retained tree; false when there was nowhere to write it. */
export type PropWriter = (id: number, key: string, value: boolean | number | null) => boolean

const choiceStates = new WeakMap<Instance, ChoiceState>()

/** Queue writes on the commit's batch. Only valid inside a React commit. */
export function commitWriter(container: Container): PropWriter {
  return (id, key, value) => {
    container.renderer.setCustomProp(id, key, value)
    return true
  }
}

/**
 * Apply writes immediately, for changes made outside a React commit. An element
 * that is not mounted yet keeps the change in its state, and mounting sends it.
 */
export function immediateWriter(container: Container): PropWriter {
  return (id, key, value) => {
    if (!container.eventTargets.has(id)) return false
    container.native.applyBatch(JSON.stringify([["setCustomPropValue", id, key, value]]))
    return true
  }
}

function stateOf(instance: Instance): ChoiceState {
  let state = choiceStates.get(instance)
  if (state === undefined) {
    state = {
      checked: false,
      dirty: false,
      defaultChecked: false,
      indeterminate: false,
      sentChecked: null,
      sentIndeterminate: null,
    }
    choiceStates.set(instance, state)
  }
  return state
}

/** Push the state Rust should see, skipping writes that would change nothing. */
function syncChoice(instance: Instance, write: PropWriter): void {
  const state = stateOf(instance)
  const kind = instance.type === "input" ? inputKind(instance.props) : "text"
  const checked = kind === "checkbox" || kind === "radio" ? state.checked : null
  const indeterminate = kind === "checkbox" ? state.indeterminate : null
  if (state.sentChecked !== checked && write(instance.id, "checked", checked)) {
    state.sentChecked = checked
  }
  if (
    state.sentIndeterminate !== indeterminate &&
    write(instance.id, "indeterminate", indeterminate)
  ) {
    state.sentIndeterminate = indeterminate
  }
}

/**
 * Set checkedness, unchecking the rest of a radio's group when it becomes
 * checked, as HTML does whatever set it.
 */
function setChecked(
  container: Container,
  instance: Instance,
  checked: boolean,
  dirty: boolean,
  write: PropWriter
): void {
  const state = stateOf(instance)
  state.checked = checked
  if (dirty) state.dirty = true
  if (checked && isRadio(instance)) {
    for (const mate of radioGroup(container, instance)) {
      if (mate === instance) continue
      stateOf(mate).checked = false
      syncChoice(mate, write)
    }
  }
  syncChoice(instance, write)
}

function authoredChecked(props: Props): boolean | undefined {
  const { checked } = props as Props & { checked?: unknown }
  return checked == null ? undefined : checked === true
}

function authoredDefaultChecked(props: Props): boolean | undefined {
  const { defaultChecked } = props as Props & { defaultChecked?: unknown }
  return defaultChecked == null ? undefined : defaultChecked === true
}

function authoredIndeterminate(props: Props): boolean | undefined {
  const { indeterminate } = props as Props & { indeterminate?: unknown }
  return indeterminate == null ? undefined : indeterminate === true
}

/**
 * ReactDOM's `initInput`: the initial state is `checked ?? defaultChecked`,
 * it becomes the default too, and it marks the input dirty, so a later
 * `defaultChecked` change only matters after a form reset.
 */
export function mountChoice(container: Container, instance: Instance, write: PropWriter): void {
  if (instance.type !== "input") return
  const state = stateOf(instance)
  const initial =
    authoredChecked(instance.props) ?? authoredDefaultChecked(instance.props) ?? false
  state.defaultChecked = initial
  state.indeterminate = authoredIndeterminate(instance.props) ?? false
  setChecked(container, instance, initial, true, write)
}

/**
 * ReactDOM's `updateInput`: a `checked` prop is re-asserted on every commit,
 * not only when it changes, and a `defaultChecked` prop moves the default.
 */
export function updateChoice(
  container: Container,
  instance: Instance,
  oldProps: Props,
  write: PropWriter
): void {
  if (instance.type !== "input") return
  const props = instance.props
  const state = stateOf(instance)

  const defaultChecked = authoredDefaultChecked(props)
  if (defaultChecked !== undefined || authoredDefaultChecked(oldProps) !== undefined) {
    state.defaultChecked = defaultChecked ?? false
    if (!state.dirty) setChecked(container, instance, state.defaultChecked, false, write)
  }

  const checked = authoredChecked(props)
  if (checked !== undefined) setChecked(container, instance, checked, true, write)

  const indeterminate = authoredIndeterminate(props)
  if (indeterminate !== undefined || authoredIndeterminate(oldProps) !== undefined) {
    state.indeterminate = indeterminate ?? false
  }

  // A checked radio that joins a group, by name, form, or type, unchecks the
  // members already there.
  const oldForm = (oldProps as { form?: unknown }).form
  const oldName = (oldProps as { name?: unknown }).name
  const regrouped =
    inputKind(oldProps) !== inputKind(props) ||
    oldName !== (props as { name?: unknown }).name ||
    oldForm !== (props as { form?: unknown }).form
  if (regrouped && state.checked && isRadio(instance)) {
    setChecked(container, instance, true, false, write)
  }
  syncChoice(instance, write)
}

export function readChecked(instance: Instance): boolean {
  return stateOf(instance).checked
}

export function readDefaultChecked(instance: Instance): boolean {
  return stateOf(instance).defaultChecked
}

export function readIndeterminate(instance: Instance): boolean {
  return stateOf(instance).indeterminate
}

/** `HTMLInputElement.checked = value`: sets the dirty flag and fires nothing. */
export function writeChecked(container: Container, instance: Instance, value: boolean): void {
  setChecked(container, instance, value, true, immediateWriter(container))
}

/** `HTMLInputElement.defaultChecked = value`, which moves `checked` too while it is not dirty. */
export function writeDefaultChecked(
  container: Container,
  instance: Instance,
  value: boolean
): void {
  const state = stateOf(instance)
  state.defaultChecked = value
  const write = immediateWriter(container)
  if (!state.dirty) setChecked(container, instance, value, false, write)
  else syncChoice(instance, write)
}

export function writeIndeterminate(
  container: Container,
  instance: Instance,
  value: boolean
): void {
  stateOf(instance).indeterminate = value
  syncChoice(instance, immediateWriter(container))
}

// ── Range state ──────────────────────────────────────────────────────

export function isRangeInput(instance: Instance): boolean {
  return instance.type === "input" && inputKind(instance.props) === "range"
}

interface RangeState {
  value: number
  /** HTML's dirty value flag: once set, the default no longer drives `value`. */
  dirty: boolean
  /** The value last written to the retained tree; `null` means removed. */
  sentValue: number | null
}

const rangeStates = new WeakMap<Instance, RangeState>()

function rangeStateOf(instance: Instance): RangeState {
  let state = rangeStates.get(instance)
  if (state === undefined) {
    state = { value: 50, dirty: false, sentValue: null }
    rangeStates.set(instance, state)
  }
  return state
}

/**
 * HTML's rules for parsing floating-point number values, for a prop that may
 * arrive as a number or a string. Rust's `range_number` must agree.
 */
function parseRangeNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string" || value.trim() !== value || value === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** A range's bounds and step: `min` 0 and `max` 100 by default, and `max` never below `min`. */
export interface RangeBounds {
  min: number
  max: number
  /** `null` for `step="any"`. */
  step: number | null
  /** The value steps count from: `min`, else the `value` attribute, else 0. */
  stepBase: number
}

export function rangeBounds(props: Props): RangeBounds {
  const { min: rawMin, max: rawMax, step: rawStep } = props as Props & {
    min?: unknown
    max?: unknown
    step?: unknown
  }
  const authoredMin = parseRangeNumber(rawMin)
  const min = authoredMin ?? 0
  const max = Math.max(min, parseRangeNumber(rawMax) ?? 100)
  const parsedStep = parseRangeNumber(rawStep)
  const step =
    typeof rawStep === "string" && rawStep.toLowerCase() === "any"
      ? null
      : parsedStep !== undefined && parsedStep > 0
        ? parsedStep
        : 1
  const stepBase = authoredMin ?? parseRangeNumber(defaultRangeAttribute(props)) ?? 0
  return { min, max, step, stepBase }
}

/**
 * HTML's value sanitization algorithm for a range: an unparsable value becomes
 * the midpoint, then the value is clamped and moved to the nearest step, ties
 * rounding up, without leaving the range.
 */
export function sanitizeRangeValue(bounds: RangeBounds, value: unknown): number {
  const { min, max, step, stepBase } = bounds
  let number = parseRangeNumber(value) ?? min + (max - min) / 2
  number = Math.min(max, Math.max(min, number))
  // Remove the binary noise fractional arithmetic leaves, so `0.1 * 3` reads as 0.3.
  if (step === null) return Number(number.toPrecision(15))
  const snapped = stepBase + Math.round((number - stepBase) / step) * step
  let result = snapped
  if (result > max) result -= step
  if (result < min) result += step
  // A range narrower than one step has no step inside it: HTML keeps the
  // clamped value.
  if (result < min || result > max) return number
  return Number(result.toPrecision(15))
}

/**
 * The `value` content attribute, which is the range's default. ReactDOM keeps
 * it in step with a controlled `value`, as it does for every input.
 */
function defaultRangeAttribute(props: Props): unknown {
  const { value, defaultValue } = props as Props & { value?: unknown; defaultValue?: unknown }
  return value ?? defaultValue
}

function syncRange(instance: Instance, write: PropWriter): void {
  const state = rangeStateOf(instance)
  if (!isRangeInput(instance)) {
    // An input that stops being a range takes its authored `value` back; the
    // custom-prop diff has already sent it, so only a missing one is cleared.
    if (state.sentValue === null) return
    const { value } = instance.props as Props & { value?: unknown }
    if (value != null || write(instance.id, "value", null)) state.sentValue = null
    return
  }
  if (state.sentValue !== state.value && write(instance.id, "value", state.value)) {
    state.sentValue = state.value
  }
}

function setRangeValue(instance: Instance, value: unknown, dirty: boolean, write: PropWriter): void {
  const state = rangeStateOf(instance)
  state.value = sanitizeRangeValue(rangeBounds(instance.props), value)
  if (dirty) state.dirty = true
  syncRange(instance, write)
}

/** ReactDOM's `initInput` for a range: the initial value is `value ?? defaultValue`. */
export function mountRange(instance: Instance, write: PropWriter): void {
  if (!isRangeInput(instance)) return
  setRangeValue(instance, defaultRangeAttribute(instance.props), false, write)
}

/**
 * ReactDOM's `updateInput` for a range. A controlled `value` is re-asserted on
 * every commit; otherwise a clean range follows its default. Either way the
 * value is sanitized again, since `min`, `max` and `step` may have moved.
 */
export function updateRange(instance: Instance, write: PropWriter): void {
  if (!isRangeInput(instance)) {
    syncRange(instance, write)
    return
  }
  const state = rangeStateOf(instance)
  const { value } = instance.props as Props & { value?: unknown }
  if (value != null) setRangeValue(instance, value, true, write)
  else if (!state.dirty) setRangeValue(instance, defaultRangeAttribute(instance.props), false, write)
  else setRangeValue(instance, state.value, false, write)
}

export function readRangeValue(instance: Instance): number {
  return rangeStateOf(instance).value
}

/** `HTMLInputElement.value = value` on a range: sanitized, sets the dirty flag, and fires nothing. */
export function writeRangeValue(container: Container, instance: Instance, value: unknown): void {
  setRangeValue(instance, value, true, immediateWriter(container))
}

/**
 * The value a range's keyboard or assistive-technology default moves to.
 * Arrow keys and increment and decrement move one step, or a hundredth of the
 * range under `step="any"`; Page Up and Page Down a tenth of the range, and at
 * least one step, as Chromium does; Home and End jump to the ends.
 */
export function rangeStepTarget(
  instance: Instance,
  action: "increment" | "decrement" | "home" | "end" | "pageUp" | "pageDown"
): number {
  const bounds = rangeBounds(instance.props)
  const value = rangeStateOf(instance).value
  const step = bounds.step ?? (bounds.max - bounds.min) / 100
  const page = Math.max(step, (bounds.max - bounds.min) / 10)
  switch (action) {
    case "increment":
      return sanitizeRangeValue(bounds, value + step)
    case "decrement":
      return sanitizeRangeValue(bounds, value - step)
    case "pageUp":
      return sanitizeRangeValue(bounds, value + page)
    case "pageDown":
      return sanitizeRangeValue(bounds, value - page)
    case "home":
      return sanitizeRangeValue(bounds, bounds.min)
    case "end":
      return sanitizeRangeValue(bounds, bounds.max)
  }
}

/**
 * A user-driven change: the value moves, marking the range dirty. Returns
 * whether it changed, which is what fires `change`.
 */
export function stepRange(container: Container, instance: Instance, value: number): boolean {
  if (value === rangeStateOf(instance).value) return false
  setRangeValue(instance, value, true, immediateWriter(container))
  return true
}

/**
 * Put a controlled range back on its `value` prop after a change React did not
 * accept, as ReactDOM's `restoreControlledState` does.
 */
export function restoreControlledRange(container: Container, instance: Instance): void {
  const { value } = instance.props as Props & { value?: unknown }
  if (value == null || !isRangeInput(instance)) return
  setRangeValue(instance, value, true, immediateWriter(container))
}

// ── Activation ───────────────────────────────────────────────────────

export interface ChoiceActivation {
  /** Whether the checkedness changed, which is what fires `change`. */
  changed: boolean
  /** HTML's legacy-canceled-activation steps, for a click whose default was prevented. */
  cancel(): void
}

/**
 * HTML's legacy-pre-activation behaviour. The state flips *before* the click
 * is dispatched, so a click handler already reads the new `checked`, and a
 * prevented click puts it back.
 *
 * `readOnly` does not apply to checkboxes and radios in HTML, so it does not
 * stop them here either. A disabled control never activates.
 */
export function beginChoiceActivation(
  container: Container,
  instance: Instance
): ChoiceActivation | undefined {
  if (!isChoiceInput(instance) || isDisabled(instance)) return undefined
  const write = immediateWriter(container)
  const state = stateOf(instance)

  if (!isRadio(instance)) {
    const { checked, indeterminate } = state
    state.indeterminate = false
    setChecked(container, instance, !checked, true, write)
    return {
      changed: true,
      cancel() {
        state.indeterminate = indeterminate
        setChecked(container, instance, checked, true, write)
      },
    }
  }

  const wasChecked = state.checked
  const previous = radioGroup(container, instance).find(
    (member) => member !== instance && stateOf(member).checked
  )
  setChecked(container, instance, true, true, write)
  return {
    changed: !wasChecked,
    cancel() {
      if (previous !== undefined && radioGroup(container, instance).includes(previous)) {
        setChecked(container, previous, true, true, write)
      } else {
        setChecked(container, instance, wasChecked, true, write)
      }
    },
  }
}

/**
 * ReactDOM's `restoreControlledState` for choice inputs: once React has
 * answered a change, a controlled input shows its prop again, and so does
 * every other member of its radio group.
 */
export function restoreControlledChoices(container: Container, instance: Instance): void {
  const write = immediateWriter(container)
  const affected = isRadio(instance) ? radioGroup(container, instance) : [instance]
  // Unchecked props first, so a controlled member that stays checked is the
  // one whose group rule runs last.
  const ordered = [...affected].sort(
    (a, b) => Number(authoredChecked(a.props) === true) - Number(authoredChecked(b.props) === true)
  )
  for (const member of ordered) {
    if (container.eventTargets.get(member.id) !== member) continue
    const state = stateOf(member)
    const checked = authoredChecked(member.props)
    if (checked !== undefined && state.checked !== checked) {
      setChecked(container, member, checked, true, write)
    }
    const indeterminate = authoredIndeterminate(member.props)
    if (indeterminate !== undefined && state.indeterminate !== indeterminate) {
      state.indeterminate = indeterminate
      syncChoice(member, write)
    }
  }
}

// ── Tree helpers ─────────────────────────────────────────────────────

function parentOf(container: Container, instance: Instance): Instance | undefined {
  return instance.parentId == null ? undefined : container.eventTargets.get(instance.parentId)
}

function isAncestor(container: Container, ancestor: Instance, node: Instance): boolean {
  const visited = new Set<number>()
  let current = parentOf(container, node)
  while (current !== undefined && !visited.has(current.id)) {
    if (current === ancestor) return true
    visited.add(current.id)
    current = parentOf(container, current)
  }
  return false
}

function rootOf(container: Container, instance: Instance): Instance {
  const visited = new Set<number>([instance.id])
  let current = instance
  let parent = parentOf(container, current)
  while (parent !== undefined && !visited.has(parent.id)) {
    visited.add(parent.id)
    current = parent
    parent = parentOf(container, current)
  }
  return current
}

/** Every mounted element, once each. Text nodes map to their parent host. */
function* mountedInstances(container: Container): Iterable<Instance> {
  for (const [id, instance] of container.eventTargets) {
    if (instance.id === id) yield instance
  }
}

function documentOrder(a: Instance, b: Instance): number {
  if (a === b) return 0
  // DOCUMENT_POSITION_FOLLOWING: `b` comes after `a`.
  return a.compareDocumentPosition(b) & 4 ? -1 : 1
}

/** The earliest element carrying this author `id`, as `getElementById` would find. */
export function elementById(
  container: Container,
  id: string,
  accept: (instance: Instance) => boolean
): Instance | undefined {
  let match: Instance | undefined
  for (const candidate of mountedInstances(container)) {
    if (candidate.props.id !== id || !accept(candidate)) continue
    if (match === undefined || documentOrder(candidate, match) < 0) match = candidate
  }
  return match
}

const FORM_ASSOCIATED_TYPES = new Set(["input", "textarea", "button"])

/**
 * HTML's form owner: the form a `form` attribute names, or else the nearest
 * ancestor `<form>`. A `form` attribute that names nothing leaves the control
 * without an owner rather than falling back to its ancestor.
 */
export function formOwner(container: Container, instance: Instance): Instance | null {
  if (!FORM_ASSOCIATED_TYPES.has(instance.type)) return null
  const form = (instance.props as Props & { form?: unknown }).form
  if (typeof form === "string" && form !== "") {
    return elementById(container, form, (candidate) => candidate.type === "form") ?? null
  }
  const visited = new Set<number>()
  let current = parentOf(container, instance)
  while (current !== undefined && !visited.has(current.id)) {
    if (current.type === "form") return current
    visited.add(current.id)
    current = parentOf(container, current)
  }
  return null
}

/**
 * The radios that share this one's group, in tree order: the same non-empty
 * `name`, the same form owner, and — without an owner — the same tree.
 */
export function radioGroup(container: Container, instance: Instance): Instance[] {
  if (!isRadio(instance)) return [instance]
  const name = (instance.props as Props & { name?: unknown }).name
  if (typeof name !== "string" || name === "") return [instance]
  const owner = formOwner(container, instance)
  const root = owner === null ? rootOf(container, instance) : null
  const members: Instance[] = []
  for (const candidate of mountedInstances(container)) {
    if (candidate !== instance) {
      if (!isRadio(candidate)) continue
      if ((candidate.props as Props & { name?: unknown }).name !== name) continue
      if (formOwner(container, candidate) !== owner) continue
      if (root !== null && rootOf(container, candidate) !== root) continue
    }
    members.push(candidate)
  }
  return members.sort(documentOrder)
}

/**
 * Whether the element or an ancestor is `display: none` — styled so, or
 * `hidden` without an authored `display` — or `ariaHidden`. Such a radio stays
 * in its group for checkedness but cannot take focus, so arrow keys skip it.
 */
export function isUnreachable(container: Container, instance: Instance): boolean {
  const visited = new Set<number>()
  let current: Instance | undefined = instance
  while (current !== undefined && !visited.has(current.id)) {
    const props = current.props as Props & { hidden?: unknown; "aria-hidden"?: unknown }
    const display = props.style?.display
    if (display === "none") return true
    if (display === undefined && props.hidden && typeof props.hidden !== "function") return true
    const ariaHidden = Object.prototype.hasOwnProperty.call(props, "ariaHidden")
      ? props.ariaHidden
      : props["aria-hidden"]
    if (ariaHidden === true || (typeof ariaHidden === "string" && ariaHidden.toLowerCase() === "true")) {
      return true
    }
    visited.add(current.id)
    current = parentOf(container, current)
  }
  return false
}

/** The labelable controls: an `<input>` other than a hidden one, a `<textarea>`, a `<button>`. */
export function isLabelable(instance: Instance): boolean {
  if (instance.type === "input") return inputKind(instance.props) !== "hidden"
  return instance.type === "textarea" || instance.type === "button"
}

/**
 * The control a `<label>` activates: the element its `htmlFor` names, or,
 * without `htmlFor`, its first labelable descendant.
 */
export function labeledControl(container: Container, label: Instance): Instance | undefined {
  const htmlFor = (label.props as Props & { htmlFor?: unknown }).htmlFor
  if (htmlFor != null) {
    if (typeof htmlFor !== "string" || htmlFor === "") return undefined
    let match: Instance | undefined
    for (const candidate of mountedInstances(container)) {
      if (!isLabelable(candidate) || candidate.props.id !== htmlFor) continue
      if (match === undefined || candidate.id < match.id) match = candidate
    }
    return match
  }
  let first: Instance | undefined
  for (const candidate of mountedInstances(container)) {
    if (!isLabelable(candidate) || !isAncestor(container, label, candidate)) continue
    if (first === undefined || documentOrder(candidate, first) < 0) first = candidate
  }
  return first
}

// ── Forms ────────────────────────────────────────────────────────────

/** The form's listed controls, in tree order. */
export function formControls(container: Container, form: Instance): Instance[] {
  const controls: Instance[] = []
  for (const candidate of mountedInstances(container)) {
    if (FORM_ASSOCIATED_TYPES.has(candidate.type) && formOwner(container, candidate) === form) {
      controls.push(candidate)
    }
  }
  return controls.sort(documentOrder)
}

function textValue(container: Container, instance: Instance): string {
  if (isRangeInput(instance)) return String(rangeStateOf(instance).value)
  const native = container.native.getInputValue?.(instance.id)
  if (typeof native === "string") return native
  const props = instance.props as Props & { value?: unknown; defaultValue?: unknown }
  return editorPropText(props.value ?? props.defaultValue) ?? ""
}

function attributeValue(instance: Instance, fallback: string): string {
  const value = (instance.props as Props & { value?: unknown }).value
  return value == null ? fallback : String(value)
}

/**
 * `HTMLInputElement.value` for the kinds the text editor does not own: a
 * range's sanitized value, or else the `value` attribute.
 */
export function attributeInputValue(instance: Instance): string {
  if (isRangeInput(instance)) return String(rangeStateOf(instance).value)
  return attributeValue(instance, inputKind(instance.props) === "hidden" ? "" : "on")
}

function isRequired(instance: Instance): boolean {
  const { required } = instance.props as Props & { required?: unknown }
  return required === true || typeof required === "string"
}

function isReadOnly(instance: Instance): boolean {
  const { readOnly } = instance.props as Props & { readOnly?: unknown }
  return readOnly === true || typeof readOnly === "string"
}

/** Whether constraint validation skips this control altogether. */
function barredFromValidation(instance: Instance): boolean {
  if (isDisabled(instance)) return true
  if (instance.type === "button") return true
  if (instance.type === "input") {
    const kind = inputKind(instance.props)
    if (kind === "hidden") return true
    // `readonly` bars text controls only; HTML ignores it on choices.
    if (kind === "text" && isReadOnly(instance)) return true
  }
  return instance.type === "textarea" && isReadOnly(instance)
}

/**
 * HTML's `valueMissing`, the one constraint this renderer checks. A radio
 * group is missing a value when any member is required and none is checked,
 * and then every member reports it.
 */
export function valueMissing(container: Container, instance: Instance): boolean {
  if (barredFromValidation(instance)) return false
  if (instance.type === "input") {
    const kind = inputKind(instance.props)
    if (kind === "checkbox") return isRequired(instance) && !stateOf(instance).checked
    if (kind === "radio") {
      const group = radioGroup(container, instance)
      return group.some(isRequired) && !group.some((member) => stateOf(member).checked)
    }
    // `required` does not apply to a range, which always has a value.
    if (kind === "range") return false
  }
  return isRequired(instance) && textValue(container, instance) === ""
}

const customValidity = new WeakMap<Instance, string>()

/** `setCustomValidity(message)`: a non-empty message makes the control invalid. */
export function setCustomValidity(instance: Instance, message: string): void {
  if (message === "") customValidity.delete(instance)
  else customValidity.set(instance, message)
}

/** `willValidate`: whether constraint validation considers this control at all. */
export function willValidate(instance: Instance): boolean {
  return !barredFromValidation(instance)
}

/**
 * The control's `ValidityState`. `valueMissing` and `customError` are the
 * flags this renderer computes; the rest are always false, since it checks no
 * other constraint.
 */
export function validityOf(container: Container, instance: Instance): ValidityState {
  const missing = valueMissing(container, instance)
  const customError = willValidate(instance) && customValidity.has(instance)
  return {
    badInput: false,
    customError,
    patternMismatch: false,
    rangeOverflow: false,
    rangeUnderflow: false,
    stepMismatch: false,
    tooLong: false,
    tooShort: false,
    typeMismatch: false,
    valid: !missing && !customError,
    valueMissing: missing,
  }
}

/** `validationMessage`: the custom message, a generic one for a missing value, or empty. */
export function validationMessage(container: Container, instance: Instance): string {
  if (!willValidate(instance)) return ""
  const custom = customValidity.get(instance)
  if (custom !== undefined) return custom
  if (!valueMissing(container, instance)) return ""
  if (instance.type === "input" && inputKind(instance.props) === "checkbox") {
    return "Please check this box if you want to proceed."
  }
  if (instance.type === "input" && inputKind(instance.props) === "radio") {
    return "Please select one of these options."
  }
  return "Please fill out this field."
}

export function checkFormValidity(container: Container, form: Instance): boolean {
  return formControls(container, form).every((control) => validityOf(container, control).valid)
}

/** HTML's "constructing the entry list", for the controls this renderer implements. */
export function formDataFor(
  container: Container,
  form: Instance,
  submitter: Instance | null
): FormData {
  const data = new FormData()
  for (const control of formControls(container, form)) {
    if (isDisabled(control)) continue
    const name = (control.props as Props & { name?: unknown }).name
    if (typeof name !== "string" || name === "") continue
    if (control.type === "button") {
      if (control === submitter) data.append(name, attributeValue(control, ""))
      continue
    }
    if (control.type === "input") {
      const kind = inputKind(control.props)
      if (kind === "checkbox" || kind === "radio") {
        if (stateOf(control).checked) data.append(name, attributeValue(control, "on"))
        continue
      }
      if (kind === "hidden") {
        data.append(name, attributeValue(control, ""))
        continue
      }
    }
    data.append(name, textValue(container, control))
  }
  return data
}

/** A `<button>`'s type, with HTML's `submit` default for a missing or unknown value. */
export function buttonType(instance: Instance): "submit" | "reset" | "button" {
  const type = (instance.props as Props & { type?: unknown }).type
  const lowered = typeof type === "string" ? type.toLowerCase() : ""
  return lowered === "reset" || lowered === "button" ? lowered : "submit"
}

function noValidate(instance: Instance | null, prop: "noValidate" | "formNoValidate"): boolean {
  const value = instance === null ? undefined : (instance.props as Record<string, unknown>)[prop]
  return value === true || typeof value === "string"
}

/**
 * `HTMLFormElement.requestSubmit()`. Validation runs unless the form or the
 * submitter opts out, and an invalid form fires nothing: this renderer has no
 * `invalid` event or validation bubble. The `submit` event carries the
 * submission's `FormData` and its submitter; there is no navigation to cancel.
 */
export function requestSubmit(
  container: Container,
  form: Instance,
  submitter: Instance | null
): GpuixEventDispatchResult | undefined {
  if (submitter !== null) {
    if (submitter.type !== "button" || buttonType(submitter) !== "submit") {
      throw new TypeError("requestSubmit: the submitter is not a submit button")
    }
    if (formOwner(container, submitter) !== form) {
      throw new TypeError("requestSubmit: the submitter is not owned by this form")
    }
  }
  const validates = !noValidate(form, "noValidate") && !noValidate(submitter, "formNoValidate")
  if (validates && !checkFormValidity(container, form)) return undefined
  return dispatchSyntheticEvent(container, form, "submit", {
    formData: formDataFor(container, form, submitter),
    submitter,
  })
}

/**
 * `HTMLFormElement.reset()`: a cancelable `reset` event, then every control
 * returns to its default. A text control's default is its `defaultValue`, or
 * its `value` when it is controlled, since ReactDOM keeps a controlled input's
 * default in step with its value.
 */
export function resetForm(container: Container, form: Instance): void {
  const result = dispatchSyntheticEvent(container, form, "reset", {})
  if (result.defaultPrevented) return
  const write = immediateWriter(container)
  for (const control of formControls(container, form)) {
    if (control.type === "button") continue
    if (control.type === "input") {
      const kind = inputKind(control.props)
      if (kind === "checkbox" || kind === "radio") {
        const state = stateOf(control)
        state.dirty = false
        setChecked(container, control, state.defaultChecked, false, write)
        continue
      }
      if (kind === "hidden") continue
      if (kind === "range") {
        rangeStateOf(control).dirty = false
        setRangeValue(control, defaultRangeAttribute(control.props), false, write)
        continue
      }
    }
    const props = control.props as Props & { value?: unknown; defaultValue?: unknown }
    container.native.setInputValue?.(control.id, editorPropText(props.value ?? props.defaultValue) ?? "")
  }
}
