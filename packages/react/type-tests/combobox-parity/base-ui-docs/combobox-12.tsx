// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Memoizing list items
import * as React from 'react';

import { Combobox } from '@gpuix/react/combobox';


function DocsExample() {
interface Fruit {
  id: string;
  label: string;
}

const fruits: Fruit[] = [];

const FruitItem = React.memo(function FruitItem({ item }: { item: Fruit }) {
  return (
    <Combobox.Item value={item}>
      <Combobox.ItemIndicator />
      <span>{item.label}</span>
    </Combobox.Item>
  );
});

<Combobox.Root<Fruit, false> items={fruits}>
  <Combobox.List>{(item: Fruit) => <FruitItem key={item.id} item={item} />}</Combobox.List>
</Combobox.Root>;
}
