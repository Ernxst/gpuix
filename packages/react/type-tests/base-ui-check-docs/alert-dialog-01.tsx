// Base UI documentation: docs/src/app/(docs)/react/components/alert-dialog/page.mdx — Anatomy
import { AlertDialog } from '@base-ui/react/alert-dialog';


function DocsExample() {

return (<>
<AlertDialog.Root>
  <AlertDialog.Trigger />
  <AlertDialog.Portal>
    <AlertDialog.Backdrop />
    <AlertDialog.Viewport>
      <AlertDialog.Popup>
        <AlertDialog.Title />
        <AlertDialog.Description />
        <AlertDialog.Close />
      </AlertDialog.Popup>
    </AlertDialog.Viewport>
  </AlertDialog.Portal>
</AlertDialog.Root>;
</>);
}
