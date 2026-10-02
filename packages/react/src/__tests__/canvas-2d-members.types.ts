import type {
  CANVAS_2D_IMPLEMENTED_MEMBERS,
  CANVAS_2D_UNSUPPORTED_MEMBERS,
} from "../canvas/context-2d.js"

// Every member of the DOM library's CanvasRenderingContext2D is either
// implemented or diagnosed. When a TypeScript upgrade adds a member, the first
// assignment fails and names it.
type Installed = keyof CanvasRenderingContext2D
type Listed =
  | (typeof CANVAS_2D_IMPLEMENTED_MEMBERS)[number]
  | (typeof CANVAS_2D_UNSUPPORTED_MEMBERS)[number]["member"]

type Unlisted = Exclude<Installed, Listed>
type Unknown = Exclude<Listed, Installed>

export const everyInstalledMemberIsListed: [Unlisted] extends [never] ? true : Unlisted = true
export const everyListedMemberIsInstalled: [Unknown] extends [never] ? true : Unknown = true
