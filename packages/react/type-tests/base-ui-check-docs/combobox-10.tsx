// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Using Combobox.Label to label a combobox
import { Combobox } from '@base-ui/react/combobox';


function DocsExample() {
return (<>
<Combobox.Root>
  {/* @highlight */}
  <Combobox.Label>Favorite fruit</Combobox.Label>
  {/* ... */}
</Combobox.Root>
</>);
}
