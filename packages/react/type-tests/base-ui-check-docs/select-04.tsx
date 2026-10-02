// Base UI documentation: docs/src/app/(docs)/react/components/select/page.mdx — Lookup map
import { Select } from '@base-ui/react/select';


function DocsExample() {
const items = {
  monospace: 'Monospace',
  serif: 'Serif',
  'san-serif': 'Sans-serif',
};

return (<>
<Select.Value>
  {/* @highlight-start */}
  {(value: keyof typeof items) => (
    <span style={{ fontFamily: value }}>
      {items[value]}
    </span>
  )}
  {/* @highlight-end */}
</Select.Value>;
</>);
}
