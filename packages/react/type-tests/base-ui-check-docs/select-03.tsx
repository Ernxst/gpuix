// Base UI documentation: docs/src/app/(docs)/react/components/select/page.mdx — items prop
import { Select } from '@base-ui/react/select';


function DocsExample() {
const items = [
  { value: null, label: 'Select theme' },
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
return (<>
<Select.Root items={items}>
  <Select.Value />
</Select.Root>;
</>);
}
