---
"@gpuix/react": minor
---

Infer the HTML-AAM implicit ARIA role for every semantic JSX alias. `<li>` in a
list is now a `listitem`, `<ul>`/`<ol>` are `list`s, `<h1>`–`<h6>` are headings
carrying their level, and `<main>`, `<nav>`, `<article>` and `<aside>` report
their landmark roles, so a tree reports the same roles under GPUIX as it does
under `react-dom`. The context-dependent roles resolve as HTML-AAM specifies:
`<header>` and `<footer>` are `banner`/`contentinfo` only outside sectioning
content, `<section>` is a `region` only when it has an accessible name, and
`<li>` is a `listitem` only inside a list. An explicit `role` still wins.

Fixes #206
