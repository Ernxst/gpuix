import type { GpuixDocument, PublicInstance } from "../types/host.js"

declare const instance: PublicInstance
declare const other: PublicInstance

const tagName: string = instance.tagName
const localName: string = instance.localName
const nodeName: string = instance.nodeName
const hasId: boolean = instance.hasAttribute("id")
const containsOther: boolean = instance.contains(other)
const containsNull: boolean = instance.contains(null)

const parent: PublicInstance | null = instance.parentElement
// The DOM's own PointerEvent type is accepted, so browser-shaped code type-checks.
const notCanceled: boolean = instance.dispatchEvent(
  new PointerEvent("click", { bubbles: true, cancelable: true, shiftKey: true })
)
// @ts-expect-error dispatchEvent takes an event object, not a type name.
instance.dispatchEvent("click")
// @ts-expect-error parentElement is read-only; it reflects the retained tree.
instance.parentElement = other
const ownerDocument: GpuixDocument = instance.ownerDocument
const byId: PublicInstance | null = ownerDocument.getElementById("panel")
const active: PublicInstance | null = ownerDocument.activeElement
// @ts-expect-error ownerDocument is read-only; every element shares the one facade.
instance.ownerDocument = ownerDocument
// @ts-expect-error The facade is not a DOM Document; it has no createElement.
ownerDocument.createElement("div")
// @ts-expect-error PublicInstance does not claim the full HTMLElement interface.
const asHtmlElement: HTMLElement = instance

void [
  tagName,
  localName,
  nodeName,
  hasId,
  containsOther,
  containsNull,
  parent,
  notCanceled,
  asHtmlElement,
  byId,
  active,
]
