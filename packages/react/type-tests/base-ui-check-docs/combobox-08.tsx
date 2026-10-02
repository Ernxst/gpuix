// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Input outside the popup
import { Combobox } from '@base-ui/react/combobox';


function DocsExample() {
return (<>
<Combobox.Root
  multiple
  onOpenChange={(open, eventDetails) => {
    if (!open && eventDetails.reason === 'item-press') {
      eventDetails.cancel();
    }
  }}
>
  {/* ... */}
</Combobox.Root>
</>);
}
