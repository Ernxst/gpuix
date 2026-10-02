// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Input inside the popup
import { Combobox } from '@base-ui/react/combobox';


function DocsExample() {
return (<>
<Combobox.Root
  multiple
  onInputValueChange={(value, eventDetails) => {
    if (eventDetails.isItemPress) {
      eventDetails.cancel();
    }
  }}
>
  {/* ... */}
</Combobox.Root>
</>);
}
