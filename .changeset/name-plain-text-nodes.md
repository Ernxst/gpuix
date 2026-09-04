---
"@gpuix/native": patch
"@gpuix/react": patch
---

Name plain text in the accessibility tree, and tie it back to the element that
paints it.

A painted string reaches AccessKit as a static-text (`Label`) node of its own —
the child a browser puts under the element that draws it — but that node carried
no host identity, so nothing mapped it to a GPUIX element. `getByRole` skipped
it, and `toHaveAccessibleName` had no node to read. A `<span>Hello</span>`, and
any element used as a label whose only child is text, were unreachable.

The renderer now records the run's element path alongside the host's, and the
test queries compute a static-text node's name from its value, which is where
AccessKit puts it for that role (`Node::label_comes_from_value`). An element
that both carries a role and paints text projects two nodes, as `<p>Hi</p>` does
in the DOM; element-level assertions read the element's own node and fall back
to the painted one.

Fixes #334
