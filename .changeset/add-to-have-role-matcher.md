---
"@gpuix/react": minor
---

Add `toHaveRole(role)` to `@gpuix/react/testing/matchers`. It reads the role the
element resolves to — the one it declares, or the one its host type implies
where it declares none — through the same resolution `getByRole` uses, so a
matcher and a query can never disagree about an element. It is the assertion for
a test that already holds the element by other means;
`toHaveAttribute('role')` is the other half of the pair and answers about the
authored role, so an `<img>` has the role `img` and no `role` attribute at all.

An element that both carries a role and paints text projects two accessibility
nodes, as `<p>Hi</p>` does in the DOM, and has both roles — the same two a role
query would find it under. An element that projects no node has no role: there
is no `generic` to fall back to.
