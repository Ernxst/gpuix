// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Using item IDs as values
import { Combobox } from '@gpuix/react/combobox';

type User = { id: string; name: string };
const users: User[] = [];

function DocsExample() {
const items = Combobox.createItems(users, {
  getValue: (user) => user.id,
  getLabel: (user) => user.name,
});

return (<>
<Combobox.Root<string, false, User> items={items}>
  <Combobox.List>
    {(user) => (
      <Combobox.Item key={user.id} value={user.id}>
        {user.name}
      </Combobox.Item>
    )}
  </Combobox.List>
</Combobox.Root>
</>);
}
