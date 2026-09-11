<p align="center"><a href="https://symfony.com" target="_blank">
    <img src="https://symfony.com/logos/symfony_dynamic_01.svg" alt="Symfony Logo">
</a></p>

<h3 align="center">
    <img src="doc/symfony-reprise.svg" alt="Symfony Reprise" height="48" align="center" valign="middle"> Symfony Reprise: Webpack Encore's heritage, for modern bundlers
</h3>

<p align="center">
  <a href="https://github.com/symfony/reprise/releases"><img src="https://img.shields.io/github/v/tag/symfony/reprise?sort=semver&label=tag&color=crimson" alt="Latest tag"></a>
  <a href="https://packagist.org/packages/symfony/reprise"><img src="https://img.shields.io/packagist/php-v/symfony/reprise?label=php&color=crimson" alt="PHP version"></a>
  <a href="https://www.npmjs.com/package/@symfony/reprise"><img src="https://img.shields.io/node/v/@symfony%2Freprise?label=node&color=crimson" alt="Node version"></a>
  <a href="https://github.com/symfony/reprise/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/symfony/reprise/ci.yml?branch=main&label=CI" alt="CI"></a>
  <a href="https://github.com/symfony/reprise/blob/main/LICENSE"><img src="https://img.shields.io/github/license/symfony/reprise?label=license&color=crimson" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/symfony/webpack-encore">Webpack Encore</a> gave Symfony first-class asset integration for Webpack.<br>
  Symfony Reprise brings the same to <strong>Vite</strong> and <strong>Rsbuild</strong>.<br>
  <br>
  📣 <a href="https://symfony.com/blog/introducing-symfony-reprise-the-symfony-integration-layer-for-modern-bundlers">Read the announcement blog post</a>
</p>

Symfony Reprise covers only the Symfony-side glue the bundlers leave out:

- 🎯 **Multiple entries**: build several independent entry points from one config
- 🎨 **Style entries**: point an entry straight at a `.scss`/`.css` file and get CSS only, no stray `<script>`
- 📄 **`entrypoints.json`**: generated in both build and dev-server modes
- 🗺️ **`manifest.json`**: maps each logical filename to its hashed URL
- 🔖 **Asset versioning**: content-hash cache busting, wired into the manifest
- 📁 **File copy**: copy static files (images, fonts…) into the build, keyed in the manifest
- 🔥 **Dev server & HMR**: points Twig at the running Vite/Rsbuild server
- 🧱 **Multiple builds**: drive several bundles (e.g. a main app and a separately-built embeddable widget) from one Symfony app
- 🏷️ **Twig tag rendering**: `reprise_entry_script_tags`/`reprise_entry_link_tags` render straight from `entrypoints.json`
- 🧩 **Symfony UX / Stimulus**: registers `controllers.json` and local controllers, eager or lazy
- 🌐 **CDN support**: serve built assets from an absolute `publicPath`
- 🛡️ **Subresource Integrity**: SRI hashes in `entrypoints.json`
- 🔐 **Customizable tag attributes**: `RenderAssetTagEvent` lets listeners add, change or remove attributes on every rendered tag (e.g. a CSP nonce)

Vite and Rsbuild already handle **Sass/Less/PostCSS**, **TypeScript**, **JSX/Vue/Svelte**, **code splitting**, **content hashing**, **source maps**, **minification** and **HMR** on their own, so Symfony Reprise does not reimplement any of that.

It generates the Encore-compatible `entrypoints.json` and `manifest.json` that Reprise's own Symfony bundle (`RepriseBundle`) reads to render the `<script>` and `<link>` tags, wires up the native dev server, and turns your Stimulus controllers into a running application.

[Read the documentation](doc/index.rst)
