---
'@gpuix/react': patch
---

Fix `toMatchScreenshot` dropping directories from a name on Windows.
`toMatchScreenshot("dir/name")` wrote `dirname.png` instead of `dir/name.png`
because the sanitizer's traversal check folded a `\` into the path with the
platform `path` module and then stripped it as a stray character.

Refs #443
