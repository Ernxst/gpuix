// Base UI documentation: docs/src/app/(docs)/react/components/select/page.mdx — Placeholder item
import { Select } from '@base-ui/react/select';


function DocsExample() {
const items = [
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

return (<>
<Select.Root items={items}>
  {/* @highlight */}
  <Select.Value placeholder="Select theme" />
</Select.Root>;
</>);
}
