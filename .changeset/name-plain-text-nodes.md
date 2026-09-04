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
any element used as a label whose only child is text, were unreachable. The
named node is the inner text element the reconciler makes for the string, not
the wrapper — the DOM's text node.

The renderer now records the run's element path alongside the host's, and the
test queries compute a static-text node's name from its value, which is where
AccessKit puts it for that role (`Node::label_comes_from_value`). An element
that both carries a role and paints text projects two nodes, as `<p>Hi</p>` does
in the DOM; element-level assertions read the element's own node and fall back
to the painted one. Only a `<text>` label carries element provenance:
`<code>`, `<markdown>`, and `<diff>` paint adapter-internal lines with no
retained element behind them, so those labels stay unaddressable by an element
query.

Text keeps its string in `value`. Issue #334 also asked for it to stop appearing
there, and that part of the issue is mistaken rather than deferred: AccessKit
takes a `Label` node's name *from* its value — `label_comes_from_value` is true
for exactly that role, and `write_label` reads a labelling node's value when it
holds one — and the macOS adapter raises a live-region announcement only for a
node that has one. `value` is where static text belongs; the bug was that
nothing read it as a name.

Fixes #334
