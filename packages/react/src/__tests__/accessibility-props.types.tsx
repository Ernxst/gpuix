import React from "react"
import type { AccessibilityRole } from "@gpuix/react"
import type { Props } from "../types/host.js"

declare module "@gpuix/react" {
  interface AccessibilityRoleRegistry {
    "consumer-web-only-role": true
  }
}

const aliases = [
  <div
    aria-label="Settings"
    aria-description="Opens application settings"
    aria-checked
    aria-expanded
    aria-current="page"
    aria-live="polite"
    aria-atomic
    aria-selected
    aria-valuetext="Medium"
    aria-valuemin={1}
    aria-valuemax={3}
    aria-valuenow={2}
    aria-level={2}
    aria-rowindex={1}
    aria-colindex={2}
    aria-rowcount={3}
    aria-colcount={4}
    aria-rowspan={1}
    aria-colspan={2}
    aria-disabled
    aria-hidden={false}
  />,
  <img aria-label="Preview" aria-hidden />,
  <div role="row" aria-rowindex={2} />,
  <div role="consumer-web-only-role" />,
  <text visuallyHidden role="heading" aria-level={1}>Production ledger</text>,
]

const aliasProps: Props = {
  "aria-label": "Settings",
  "aria-description": "Opens application settings",
  "aria-checked": true,
  "aria-expanded": true,
  "aria-current": "page",
  "aria-live": "polite",
  "aria-atomic": true,
  "aria-selected": true,
  "aria-valuetext": "Medium",
  "aria-valuemin": 1,
  "aria-valuemax": 3,
  "aria-valuenow": 2,
  "aria-level": 2,
  "aria-rowindex": 1,
  "aria-colindex": 2,
  "aria-rowcount": 3,
  "aria-colcount": 4,
  "aria-rowspan": 1,
  "aria-colspan": 2,
  "aria-disabled": true,
  "aria-hidden": false,
}
const currentTokens: Props[] = [
  { ariaCurrent: "page" },
  { ariaCurrent: "step" },
  { ariaCurrent: "location" },
  { ariaCurrent: "date" },
  { ariaCurrent: "time" },
  { ariaCurrent: "true" },
  { "aria-current": "false" },
]
const liveTokens: Props[] = [
  { ariaLive: "off" },
  { ariaLive: "polite" },
  { ariaLive: "assertive" },
  { "aria-live": "assertive", ariaAtomic: "true" },
]
const roleVocabulary = [
  "table",
  "rowgroup",
  "row",
  "columnheader",
  "rowheader",
  "cell",
  "list",
  "listitem",
  "listbox",
  "option",
  "region",
  "banner",
  "main",
  "navigation",
  "contentinfo",
  "complementary",
  "search",
  "form",
  "group",
  "heading",
  "sectionheader",
  "caption",
  "consumer-web-only-role",
] satisfies AccessibilityRole[]
// @ts-expect-error aria-busy has no supported GPUIX accessibility prop.
const unsupportedProps: Props = { "aria-busy": true }
// @ts-expect-error ariaCurrent accepts only the ARIA current-item token set.
const invalidCurrent: Props = { ariaCurrent: "chapter" }
// @ts-expect-error ariaLive accepts only the ARIA live-region politeness tokens.
const invalidLive: Props = { ariaLive: "rude" }
// @ts-expect-error disabled is an HTML boolean attribute, not an ARIA Booleanish attribute.
const invalidDisabled: Props = { disabled: "false" }
const visuallyHidden: Props = { visuallyHidden: true }
// @ts-expect-error visuallyHidden is true-only until a focus-revealed mode is implemented.
const falseVisuallyHidden: Props = { visuallyHidden: false }
// @ts-expect-error untilFocus is deliberately reserved as a future additive value.
const futureVisuallyHidden: Props = { visuallyHidden: "untilFocus" }

void aliases
void aliasProps
void currentTokens
void liveTokens
void roleVocabulary
void unsupportedProps
void invalidCurrent
void invalidLive
void invalidDisabled
void visuallyHidden
void falseVisuallyHidden
void futureVisuallyHidden
