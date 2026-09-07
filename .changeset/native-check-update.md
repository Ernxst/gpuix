---
'@gpuix/native': minor
'@gpuix/react': patch
---

Add `checkUpdate()` on `@gpuix/native` so a packaged app can update itself.

This is a port of [cargo-packager-updater](https://docs.rs/cargo-packager-updater/latest/cargo_packager_updater/) inside the existing `.node`. HTTP uses the same `reqwest_client` as `<img>`. There is no second native addon and no crates.io `reqwest`.

```tsx
import { checkUpdate } from '@gpuix/native'

const update = await checkUpdate('0.1.0', {
  endpoints: [
    'https://github.com/OWNER/REPO/releases/latest/download/latest.json',
  ],
  pubkey: '<public key from cargo packager signer generate>',
})
if (update) await update.downloadAndInstall()
```

Host the feed on **GitHub Releases**. Create the release first. On each OS run `cargo packager --release --config packager.json` with `CARGO_PACKAGER_SIGN_PRIVATE_KEY` set, then `gh release upload v0.1.0 bundle/... --clobber`. Packager names: macOS `My App.app.tar.gz` (only after signing), Linux `app_0.1.0_x86_64.AppImage`, Windows `app_0.1.0_x64-setup.exe`. Upload a `latest.json` whose `signature` fields are the `.sig` file contents. `downloadAndInstall()` replaces the packaged files and does not relaunch.

Desktop only. HTTPS lives in the native crate, so Bun and hermes-node both work. The browser wasm build does not export this.
