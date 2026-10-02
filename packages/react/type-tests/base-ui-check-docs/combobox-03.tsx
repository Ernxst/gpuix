// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Specifying generic type parameters
import * as React from 'react';

import { Combobox } from '@base-ui/react/combobox';



export function MyCombobox<Value, Multiple extends boolean | undefined = false, Item = Value>(
  props: Combobox.Root.Props<Value, Multiple, Item>,
): React.JSX.Element {
  return <Combobox.Root {...props}>{/* ... */}</Combobox.Root>;
}
