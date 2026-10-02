// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Anatomy
import { Combobox } from '@base-ui/react/combobox';


function DocsExample() {

return (<>
<Combobox.Root>
  <Combobox.Label />

  <Combobox.InputGroup>
    <Combobox.Input />
    <Combobox.Trigger />
    <Combobox.Icon />
    <Combobox.Clear />
    <Combobox.Value />

    <Combobox.Chips>
      <Combobox.Chip>
        <Combobox.ChipRemove />
      </Combobox.Chip>
    </Combobox.Chips>
  </Combobox.InputGroup>

  <Combobox.Portal>
    <Combobox.Backdrop />
    <Combobox.Positioner>
      <Combobox.Popup>
        <Combobox.Arrow />

        <Combobox.Status />
        <Combobox.Empty />

        <Combobox.List>
          <Combobox.Row>
            <Combobox.Item>
              <Combobox.ItemIndicator />
            </Combobox.Item>
          </Combobox.Row>

          <Combobox.Separator />

          <Combobox.Group>
            <Combobox.GroupLabel />
          </Combobox.Group>

          <Combobox.Collection>{() => null}</Combobox.Collection>
        </Combobox.List>
      </Combobox.Popup>
    </Combobox.Positioner>
  </Combobox.Portal>
</Combobox.Root>;
</>);
}
