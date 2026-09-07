---
'@gpuix/native': minor
'@gpuix/react': patch
---

Add `checkUpdate()` on `@gpuix/native` so a packaged app can update itself from GitHub Releases.

HTTP uses the same `reqwest_client` as `<img>`. There is no second native addon and no feed JSON.

```tsx
import { checkUpdate } from '@gpuix/native'

const update = await checkUpdate('0.1.0', {
  endpoints: ['https://github.com/OWNER/REPO/releases/latest'],
  pubkey: '<public key from cargo packager signer generate>',
})
if (update) await update.downloadAndInstall()
```

Create the GitHub release first. On each OS run `cargo packager --release --config packager.json` with `CARGO_PACKAGER_SIGN_PRIVATE_KEY` set, then `gh release upload` the bundle and its `.sig`. Packager names: macOS `My App.app.tar.gz` (only after signing), Linux `app_0.1.0_x86_64.AppImage`, Windows `app_0.1.0_x64-setup.exe`. The updater reads `api.github.com` latest, matches the host asset, and GETs the sibling `.sig`. `downloadAndInstall()` replaces the packaged files and does not relaunch.

Desktop only. HTTPS lives in the native crate, so Bun and hermes-node both work. The browser wasm build does not export this.
