// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Creating a collection from dynamic data
import * as React from 'react';

import { Combobox } from '@base-ui/react/combobox';

type User = { id: string; name: string };
const users: User[] = [];

function DocsExample() {
const items = React.useMemo(
  () =>
    Combobox.createItems(users, {
      getValue: (user) => user.id,
      getLabel: (user) => user.name,
    }),
  [users],
);
}
