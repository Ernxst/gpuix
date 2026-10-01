import React from "react"
import { Combobox } from "@base-ui/react/combobox"

type Person = { id: number; name: string }
const people: Person[] = [{ id: 1, name: "Ada Lovelace" }]
const collection = Combobox.createItems(people, {
  getValue: (person) => person.id,
  getLabel: (person) => person.name,
})
const filter = Combobox.useFilter({ sensitivity: "base" })

export function ComboboxParityFixture() {
  function VisiblePeople() {
    const filtered = Combobox.useFilteredItems<Person>()
    return <span>{filtered.map((person) => person.name).join(", ")}</span>
  }

  return (
    <Combobox.Root<number, false, Person>
      items={collection}
      filter={(person, query, itemToString) => filter.contains(person, query, itemToString)}
      value={1}
      onValueChange={(value, details) => {
        value?.toFixed()
        details.reason satisfies string
        details.cancel()
      }}
      onInputValueChange={(value, details) => {
        value.toLowerCase()
        details.event
      }}
      onOpenChange={(open, details) => {
        open.valueOf()
        details.reason
      }}
      onItemHighlighted={(value, details) => {
        value?.toFixed()
        details.index.toFixed()
      }}
      readOnly={false}
      required={false}
      autoComplete="email"
      locale="en"
      openOnInputClick
      autoHighlight
    >
      <Combobox.InputGroup className={(state) => state.open && state.focused ? "open" : undefined} />
      <Combobox.Label render={<label />} className={(state) => state.dirty && state.touched ? "edited" : undefined} />
      <Combobox.Input render={<input />} style={(state) => state.disabled || !state.valid ? { opacity: 0.5 } : {}} />
      <Combobox.Trigger render={<button />} className={(state) => state.placeholder ? "empty" : undefined} />
      <Combobox.Value placeholder="Choose a person" />
      <Combobox.Icon />
      <Combobox.Portal container={null} keepMounted>
        <Combobox.Backdrop />
        <Combobox.Positioner
          anchor={null}
          side="bottom"
          align="end"
          sideOffset={({ anchor }) => anchor.height}
          alignOffset={2}
          positionMethod="fixed"
          collisionPadding={{ top: 8, right: 12, bottom: 8, left: 12 }}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
          sticky
          arrowPadding={4}
          disableAnchorTracking
          style={(state) => state.open ? { opacity: 1 } : {}}
        >
          <Combobox.Popup finalFocus={false}>
            <VisiblePeople />
            <Combobox.Status>Loading…</Combobox.Status>
            <Combobox.Empty>No matches</Combobox.Empty>
            <Combobox.List>
              <Combobox.Group items={people}>
                <Combobox.GroupLabel>People</Combobox.GroupLabel>
                <Combobox.Collection>
                  {(person, index) => (
                    <Combobox.Item key={person.id} value={person.id} index={index} disabled={false} render={<div />}>
                      {person.name}
                    </Combobox.Item>
                  )}
                </Combobox.Collection>
              </Combobox.Group>
              <Combobox.Row />
              <Combobox.ItemIndicator keepMounted />
              <Combobox.Arrow />
              <Combobox.Separator orientation="vertical" />
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
      <Combobox.Chips>
        <Combobox.Chip>
          <Combobox.ChipRemove render={<button />} />
        </Combobox.Chip>
      </Combobox.Chips>
      <Combobox.Clear keepMounted />
    </Combobox.Root>
  )
}

void React

type RootAliases = [
  Combobox.Root.Props<number, false, Person>,
  Combobox.Root.State,
  Combobox.Root.Actions,
  Combobox.Root.ChangeEventReason,
  Combobox.Root.ChangeEventDetails,
  Combobox.Root.HighlightEventReason,
  Combobox.Root.HighlightEventDetails,
]
type PartAliases = [
  Combobox.Label.Props, Combobox.Label.State,
  Combobox.Value.Props, Combobox.Value.State,
  Combobox.Input.Props, Combobox.Input.State,
  Combobox.InputGroup.Props, Combobox.InputGroup.State,
  Combobox.Trigger.Props, Combobox.Trigger.State,
  Combobox.List.Props, Combobox.List.State,
  Combobox.Status.Props, Combobox.Status.State,
  Combobox.Portal.Props, Combobox.Portal.State,
  Combobox.Backdrop.Props, Combobox.Backdrop.State,
  Combobox.Positioner.Props, Combobox.Positioner.State,
  Combobox.Popup.Props, Combobox.Popup.State,
  Combobox.Arrow.Props, Combobox.Arrow.State,
  Combobox.Icon.Props, Combobox.Icon.State,
  Combobox.Group.Props, Combobox.Group.State,
  Combobox.GroupLabel.Props, Combobox.GroupLabel.State,
  Combobox.Item.Props, Combobox.Item.State,
  Combobox.ItemIndicator.Props, Combobox.ItemIndicator.State,
  Combobox.Chips.Props, Combobox.Chips.State,
  Combobox.Chip.Props, Combobox.Chip.State,
  Combobox.ChipRemove.Props, Combobox.ChipRemove.State,
  Combobox.Row.Props, Combobox.Row.State,
  Combobox.Collection.Props, Combobox.Collection.State,
  Combobox.Empty.Props, Combobox.Empty.State,
  Combobox.Clear.Props, Combobox.Clear.State,
  Combobox.Separator.Props, Combobox.Separator.State,
]
export type ComboboxNamespaceParity = RootAliases | PartAliases
