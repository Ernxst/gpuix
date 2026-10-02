// Base UI documentation: docs/src/app/(docs)/react/components/dialog/page.mdx — Controlled dialog
import * as React from 'react';

import { Dialog } from '@base-ui/react/dialog';

declare const open: boolean;
const setOpen = (_: boolean) => {};
declare function submitData(): Promise<void>;

function DocsExample() {
const [open, setOpen] = React.useState(false);
return (
  <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger>Open</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Popup>
        <form
          // Close the dialog once the form data is submitted
          onSubmit={async () => {
            await submitData();
            setOpen(false);
          }}
        >
          ...
        </form>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
);
}
