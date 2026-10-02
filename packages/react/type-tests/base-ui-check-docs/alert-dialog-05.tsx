// Base UI documentation: docs/src/app/(docs)/react/components/alert-dialog/page.mdx — Detached triggers with payload
import { AlertDialog } from '@base-ui/react/alert-dialog';


function DocsExample() {
const demoAlertDialog = AlertDialog.createHandle<{ message: string }>();
return (<>
<AlertDialog.Trigger handle={demoAlertDialog} payload={{ message: 'Trigger 1' }}>
  Trigger 1
</AlertDialog.Trigger>
<AlertDialog.Trigger handle={demoAlertDialog} payload={{ message: 'Trigger 2' }}>
  Trigger 2
</AlertDialog.Trigger>

<AlertDialog.Root handle={demoAlertDialog}>
  {({ payload }) => ( // @highlight-text "payload"
    <AlertDialog.Portal>
      <AlertDialog.Popup>
        <AlertDialog.Title>Alert dialog</AlertDialog.Title>
        {payload !== undefined && ( // @highlight-text "payload"
          <AlertDialog.Description>
            Confirming {payload.message} 
          </AlertDialog.Description>
        )}
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  )}
</AlertDialog.Root>
</>);
}
