import React from "react"
import { Combobox } from "@combobox"

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
      autoComplete="both"
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
