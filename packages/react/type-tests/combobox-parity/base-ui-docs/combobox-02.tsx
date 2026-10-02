// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Using item objects as values
import { Combobox } from '@gpuix/react/combobox';


type Item = { id: string; label: string };
const itemObjects: Item[] = [];

function DocsExample() {
return (<>
<Combobox.Root<Item> items={itemObjects}>
<Combobox.List>
  {(item) => (
    <Combobox.Item key={item.id} value={item}>
      {item.label}
    </Combobox.Item>
  )}
</Combobox.List>
</Combobox.Root>
</>);
}
