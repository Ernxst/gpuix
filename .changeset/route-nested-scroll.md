---
'@gpuix/native': patch
'@gpuix/react': patch
---

Route nested wheel gestures from the innermost scrollable div or virtual list
to its ancestors. Inner scrollers consume only their remaining range, pass the
residual delta at a boundary, and keep phased trackpad gestures on their
recognized axis through stalls and macOS momentum without scheduling extra
draws. Strong direction changes can still switch the recognized axis.

Fixes #16
