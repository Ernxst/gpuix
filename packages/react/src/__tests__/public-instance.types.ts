import type { PublicInstance } from "../types/host.js"

declare const instance: PublicInstance
declare const other: PublicInstance

const tagName: string = instance.tagName
const localName: string = instance.localName
const nodeName: string = instance.nodeName
const hasId: boolean = instance.hasAttribute("id")
const containsOther: boolean = instance.contains(other)
const containsNull: boolean = instance.contains(null)

const parent: PublicInstance | null = instance.parentElement
// @ts-expect-error parentElement is read-only; it reflects the retained tree.
instance.parentElement = other
// @ts-expect-error PublicInstance does not claim the full HTMLElement interface.
const asHtmlElement: HTMLElement = instance

void [tagName, localName, nodeName, hasId, containsOther, containsNull, parent, asHtmlElement]
