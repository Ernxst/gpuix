// Base UI documentation: docs/src/app/(docs)/react/components/alert-dialog/page.mdx — Detached triggers
import { AlertDialog } from '@base-ui/react/alert-dialog';


function DocsExample() {
const demoAlertDialog = AlertDialog.createHandle();
return (<>
<AlertDialog.Trigger handle={demoAlertDialog}>Open</AlertDialog.Trigger>
<AlertDialog.Root handle={demoAlertDialog}>
  ...
</AlertDialog.Root>
</>);
}
