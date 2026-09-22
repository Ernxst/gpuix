import React from "react"
import type { AccessibilityRole } from "@gpuix/react"
import type { InputProps, Props } from "../types/host.js"

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
    aria-pressed="mixed"
    aria-orientation="horizontal"
    aria-readonly
    aria-required="true"
    aria-invalid="grammar"
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
    aria-controls="settings-panel"
    aria-haspopup="menu"
    aria-roledescription="Settings button"
    aria-relevant="additions text"
    hidden
  />,
  <section hidden={false} ariaControls="panel-a panel-b" />,
  <img aria-label="Preview" aria-hidden />,
  <div role="row" aria-rowindex={2} />,
  <div role="consumer-web-only-role" />,
  <text visuallyHidden role="heading" aria-level={1}>Production ledger</text>,
]

const aliasProps: Props = {
  "aria-label": "Settings",
  "aria-description": "Opens application settings",
  "aria-checked": true,
  "aria-pressed": "mixed",
  "aria-orientation": "vertical",
  "aria-readonly": true,
  "aria-required": "false",
  "aria-invalid": "spelling",
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
  "aria-controls": "settings-panel",
  "aria-haspopup": "dialog",
  "aria-roledescription": "Number field",
  "aria-relevant": "all",
  hidden: false,
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
const pressedStates: Props[] = [
  { ariaPressed: true },
  { ariaPressed: false },
  { ariaPressed: "mixed" },
  { "aria-pressed": true },
  { "aria-pressed": false },
  { "aria-pressed": "mixed" },
]
const remainingBaseUiStates: Props[] = [
  { ariaOrientation: "horizontal", ariaReadOnly: true, ariaRequired: "true", ariaInvalid: true },
  {
    "aria-orientation": "vertical",
    "aria-readonly": "false",
    "aria-required": false,
    "aria-invalid": "grammar",
  },
  { ariaInvalid: "spelling" },
  { ariaInvalid: "false" },
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
// @ts-expect-error ariaPressed accepts only the ARIA tri-state value set.
const invalidPressed: Props = { ariaPressed: "yes" }
// @ts-expect-error ariaOrientation accepts only physical axis tokens.
const invalidOrientation: Props = { ariaOrientation: "diagonal" }
// @ts-expect-error ariaInvalid accepts only the DOM-compatible validity tokens.
const invalidInvalid: Props = { ariaInvalid: "format" }
// @ts-expect-error ariaLive accepts only the ARIA live-region politeness tokens.
const invalidLive: Props = { ariaLive: "rude" }
// @ts-expect-error disabled is an HTML boolean attribute, not an ARIA Booleanish attribute.
const invalidDisabled: Props = { disabled: "false" }
const popupTokens: Props[] = [
  { ariaHasPopup: true },
  { ariaHasPopup: false },
  { ariaHasPopup: "true" },
  { ariaHasPopup: "false" },
  { ariaHasPopup: "menu" },
  { ariaHasPopup: "listbox" },
  { ariaHasPopup: "tree" },
  { ariaHasPopup: "grid" },
  { "aria-haspopup": "dialog" },
]
const roleDescriptions: Props[] = [
  { ariaRoleDescription: "Number field" },
  { "aria-roledescription": "slide" },
]
const relevantTokens: Props[] = [
  { ariaRelevant: "additions" },
  { ariaRelevant: "removals" },
  { ariaRelevant: "text" },
  { ariaRelevant: "all" },
  { ariaRelevant: "additions removals" },
  { "aria-relevant": "text removals" },
]
// @ts-expect-error ariaHasPopup accepts only the ARIA popup token set.
const invalidHasPopup: Props = { ariaHasPopup: "popover" }
// @ts-expect-error aria-haspopup accepts only the ARIA popup token set.
const invalidHasPopupAlias: Props = { "aria-haspopup": "sheet" }
// @ts-expect-error ariaRoleDescription is a string.
const invalidRoleDescription: Props = { ariaRoleDescription: 3 }
// @ts-expect-error ariaRelevant accepts only DOM-compatible token combinations.
const invalidRelevant: Props = { ariaRelevant: "everything" }
// @ts-expect-error aria-relevant accepts only DOM-compatible token combinations.
const invalidRelevantAlias: Props = { "aria-relevant": "additions additions" }
const rangeInput: InputProps = {
  type: "range",
  min: 0,
  max: "100",
  step: "any",
  value: "40",
  "aria-orientation": "horizontal",
}
const visuallyHidden: Props = { visuallyHidden: true }
// @ts-expect-error visuallyHidden is true-only until a focus-revealed mode is implemented.
const falseVisuallyHidden: Props = { visuallyHidden: false }
// @ts-expect-error untilFocus is deliberately reserved as a future additive value.
const futureVisuallyHidden: Props = { visuallyHidden: "untilFocus" }

void aliases
void aliasProps
void currentTokens
void pressedStates
void remainingBaseUiStates
void liveTokens
void roleVocabulary
void unsupportedProps
void invalidCurrent
void invalidPressed
void invalidOrientation
void invalidInvalid
void invalidLive
void invalidDisabled
void popupTokens
void roleDescriptions
void relevantTokens
void invalidHasPopup
void invalidHasPopupAlias
void invalidRoleDescription
void invalidRelevant
void invalidRelevantAlias
void rangeInput
void visuallyHidden
void falseVisuallyHidden
void futureVisuallyHidden
