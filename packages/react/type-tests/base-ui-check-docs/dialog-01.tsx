// Base UI documentation: docs/src/app/(docs)/react/components/dialog/page.mdx — Anatomy
import { Dialog } from '@base-ui/react/dialog';


function DocsExample() {

return (<>
<Dialog.Root>
  <Dialog.Trigger />
  <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Viewport>
      <Dialog.Popup>
        <Dialog.Title />
        <Dialog.Description />
        <Dialog.Close />
      </Dialog.Popup>
    </Dialog.Viewport>
  </Dialog.Portal>
</Dialog.Root>;
</>);
}
