import type { JSX as DevJSX } from "../../jsx-dev-runtime.js"
import type { JSX as RuntimeJSX } from "../../jsx-runtime.js"

const runtimeLabel: RuntimeJSX.IntrinsicElements["label"] = { htmlFor: "email" }
const devRuntimeLabel: DevJSX.IntrinsicElements["label"] = { htmlFor: "email" }

void [runtimeLabel, devRuntimeLabel]
