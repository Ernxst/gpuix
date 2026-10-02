// Base UI documentation: docs/src/app/(docs)/react/components/select/page.mdx — Using Select.Label to label a select
import { Select } from '@base-ui/react/select';


function DocsExample() {
return (<>
<Select.Root>
  {/* @highlight */}
  <Select.Label>Theme</Select.Label>
  {/* ... */}
</Select.Root>
</>);
}
