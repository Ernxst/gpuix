// Base UI documentation: docs/src/app/(docs)/react/components/select/page.mdx — Specifying generic type parameters
import * as React from 'react';

import { Select } from '@base-ui/react/select';



export function MySelect<Value, Multiple extends boolean | undefined = false>(
  props: Select.Root.Props<Value, Multiple>,
): React.JSX.Element {
  return <Select.Root {...props}>{/* ... */}</Select.Root>;
}
