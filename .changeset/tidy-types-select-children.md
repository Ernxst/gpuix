---
"@gpuix/react": patch
---

Expose Base UI-shaped `Props` and `State` type namespaces on the Select,
Tooltip, Dialog, and AlertDialog parts. Accept state-function children on
`Select.ItemText`, keep their unhighlighted label for the trigger and
typeahead, and type `Select.Value` callbacks like Base UI.
