---
'@gpuix/react': patch
---

Depend on `@gpuix/native` by version instead of `workspace:^`.

`bun pm pack` does not rewrite the `workspace:` protocol, so every packed `@gpuix/react` carried a
spec that means nothing outside this repo: a consumer install died on `@gpuix/native@workspace:^
failed to resolve`. The dependency now names the concrete version, `0.8.0-fork.1`. Bun still
resolves an in-range version to the local workspace package, so workspace development is
unchanged.

This is not on its own enough to install the two tarballs. Bun resolves that inner dependency from
the registry rather than from a top-level tarball pin, so a consumer needs an `overrides` entry
pointing `@gpuix/native` at the same tarball either way — see "Consuming an unpublished checkout"
in the README.

The two versions must stay in lockstep at release time. This repo has no `.changeset/config.json`,
so nothing bumps the dependency automatically — see the release order in AGENTS.md.
