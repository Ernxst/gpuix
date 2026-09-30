import type { Props, SharedStyle, StyleDesc, VirtualListProps } from "../../dist/index.js"
import type { JSX } from "../../jsx-runtime.js"

const sharedStyle: SharedStyle = { flexGrow: 1 }
const nativeStyle: StyleDesc = sharedStyle
const hostStyle: Props["style"] = sharedStyle

const virtualListProps: VirtualListProps = {
  style: sharedStyle,
  className: "rows",
  "data-testid": "rows",
  "aria-label": undefined,
  itemCount: undefined,
}
const virtualListElementProps: JSX.IntrinsicElements["virtual-list"] = {
  className: "rows",
  "data-testid": "rows",
}

const hostProps: Props = {
  style: sharedStyle,
  "aria-label": undefined,
  id: undefined,
  className: undefined,
  "data-testid": undefined,
}

void nativeStyle
void hostStyle
void virtualListProps
void virtualListElementProps
void hostProps
