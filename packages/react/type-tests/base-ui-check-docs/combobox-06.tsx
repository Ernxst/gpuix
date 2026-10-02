// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Displaying a window of async results
import * as React from 'react';

import { Combobox } from '@base-ui/react/combobox';

type KnownUser = { id: string; name: string };
const knownUsers: KnownUser[] = [];
const searchResults: KnownUser[] = [];
const selectedUserId: string | null = null;
const setSelectedUserId = (_: string | null) => {};

function DocsExample() {
const items = React.useMemo(
  () =>
    Combobox.createItems(knownUsers, {
      getValue: (user) => user.id,
      getLabel: (user) => user.name,
    }),
  [knownUsers],
);

return (<>
<Combobox.Root
  items={items}
  filteredItems={searchResults}
  value={selectedUserId}
  onValueChange={setSelectedUserId}
/>;
</>);
}
