import type { JSX as DesktopJSX } from "../../jsx-runtime.js"
import type { JSX as DevJSX } from "../../jsx-dev-runtime.js"

const desktopHeader: DesktopJSX.IntrinsicElements["th"] = {
  scope: "col",
  colSpan: 2,
  headers: "item-name",
}
const devHeader: DevJSX.IntrinsicElements["th"] = {
  scope: "row",
  rowSpan: 2,
}

void [desktopHeader, devHeader]
