import { Combobox } from "@gpuix/react/combobox"

const untypedItems: any[] = []

export function ComboboxCompatibilityFixture() {
  return (
    <Combobox.Root items={untypedItems}>
      <Combobox.List>
        {(item: unknown) => <Combobox.Item value={item}>{String(item)}</Combobox.Item>}
      </Combobox.List>
      <Combobox.Value>Selected item</Combobox.Value>
    </Combobox.Root>
  )
}
