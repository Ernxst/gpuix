---
'@gpuix/native': patch
'@gpuix/react': patch
---

Match Base UI Tooltip behaviour for popup composition, change cancellation and
Escape propagation, controlled no-op changes, Arrow accessibility, hover
dismissal and delay, detached handles, and handle attachment warnings. Preserve
trigger payloads across handoffs and apply
Tooltip positioner offsets and hoverability settings, including resolved
placement data for offset callbacks. Keep closed popups mounted and hidden when
`Tooltip.Portal keepMounted` is set, remount Tooltip.Viewport's current content
when its active trigger or payload changes.

Fixes #845
Fixes #846
Fixes #847
Fixes #848
Fixes #849
Fixes #851
Fixes #852
Fixes #853
Fixes #856
Fixes #857
Fixes #862
Fixes #885
