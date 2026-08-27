# CHANGELOG

## 1.1.0

- Add support for the top-level `input` option in dev mode, added in Vite 8.2

## 1.0.0

Stable release! 🎉

## 0.8.0

- Add a per-entry `hash` option to `copy` (default `true`): with `hash: false` the file is emitted at its logical path instead of a content-hashed one, and the hash moves to the `manifest.json` value as a `?<contenthash>` query string
- Support an empty `to` on a `copy` entry, emitting the files at the root of `outputPath`

## 0.7.0

- Add the `RenderAssetTagEvent`, dispatched before each rendered `<script>`/`<link>` (including the injected dev client and React preamble), so listeners can add, change or remove attributes such as a CSP nonce

## 0.6.0

- Add a per-call `attributes` argument to the `reprise_entry_script_tags()` and `reprise_entry_link_tags()` Twig functions
- Add the `reprise_entry_exists()` Twig function
- Add support for multiple named builds via the `builds` config and a `build` argument on the Twig functions

## 0.5.0

- Require Vite `^7.0` or `^8.0`; Vite 7 is now the minimum supported version
- Require Rsbuild `^1.7` or `^2.0`; Rsbuild 1.7 is now the minimum supported version

## 0.4.0

- Support React Fast Refresh (HMR) with Vite by rendering the `@vitejs/plugin-react` preamble in dev

## 0.3.0

- Fix an entry's CSS being silently dropped under Vite when the entry is emitted as a facade chunk (a top-level `await` in an entry also imported by another entry)
- Prefer `build.rolldownOptions` over the deprecated `build.rollupOptions` (rolldown-vite / Vite 8)

## 0.2.0

- Update Unplugin from ^2.3.4 to ^3.3.0
- Rsbuild support now runs on unplugin's `createRsbuildPlugin`
- Fix the Rsbuild dev server to target `localhost` instead of a hardcoded `127.0.0.1`

## 0.1.0

- Initial release
