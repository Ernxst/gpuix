// Base UI documentation: docs/src/app/(docs)/react/components/dialog/page.mdx — Uncontrolled dialog
import { Dialog } from '@base-ui/react/dialog';


function DocsExample() {
return (<>
<Dialog.Root>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Popup>
      <Dialog.Title>Example dialog</Dialog.Title>
      <Dialog.Close>Close</Dialog.Close>
    </Dialog.Popup>
  </Dialog.Portal>
</Dialog.Root>
</>);
}
