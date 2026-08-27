Symfony Reprise
===============

Webpack Encore gave Symfony first-class asset integration for Webpack. Symfony Reprise brings the same to `Vite`_
and `Rsbuild`_.

.. tip::

    Still using Webpack Encore? See `Migrating from Webpack Encore`_ below: it maps every ``Encore.*`` call to its
    Vite/Rsbuild or Reprise equivalent.

Vite and Rsbuild already handle **Sass/Less/PostCSS**, **TypeScript**, **JSX/Vue/Svelte**, **code splitting**,
**content hashing**, **source maps**, **minification** and **HMR** on their own, so Symfony Reprise does not
reimplement any of that. It covers only the Symfony-side glue the bundlers leave out:

- **Multiple entries**: build several independent entry points from one config
- ``entrypoints.json``: generated in both build and dev-server modes
- ``manifest.json``: maps each logical filename to its hashed URL
- **Asset versioning**: content-hash cache busting, wired into the manifest
- **File copy**: copy static files into the build, keyed in the manifest
- **Dev server and HMR**: points Twig at the running Vite/Rsbuild server
- **Multiple builds**: drive several bundles (e.g. a main app and a separately-built embeddable widget) from one Symfony app
- **Twig tag rendering**: ``reprise_entry_script_tags``/``reprise_entry_link_tags`` render straight from
  ``entrypoints.json``
- **Symfony UX / Stimulus**: registers ``controllers.json`` and local controllers, eager or lazy
- **CDN support**: serve built assets from an absolute ``publicPath``
- **Subresource Integrity**: SRI hashes in ``entrypoints.json``
- **Customizable tag attributes**: ``RenderAssetTagEvent`` lets listeners add, change or remove attributes on every rendered tag

It generates the Encore-compatible ``entrypoints.json`` and ``manifest.json`` that ``RepriseBundle`` reads to render
the ``<script>`` and ``<link>`` tags, wires up the native dev server, and turns your Stimulus controllers into a
running application.

Installation
------------

Install the bundle with Composer and Symfony Flex:

.. code-block:: terminal

    $ composer require symfony/reprise

Then install the npm package:

.. code-block:: terminal

    $ npm install @symfony/reprise --save-dev

Vite
~~~~

.. code-block:: javascript

    // vite.config.ts
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig({
      input: {
        app: './assets/app.js',
      },
      plugins: [
        Symfony({
          // options
        }),
      ],
    })

On Vite 8.1 and older, configure the entries with ``build.rollupOptions.input`` instead.

Rsbuild
~~~~~~~

.. code-block:: javascript

    // rsbuild.config.ts
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig({
      source: {
        entry: {
          app: './assets/app.js',
        },
      },
      plugins: [
        Symfony({
          // options
        }),
      ],
    })

Rendering asset tags
--------------------

This is where Reprise pays off: once ``entrypoints.json`` exists, ``RepriseBundle`` reads it and renders the
``<script>`` and ``<link>`` tags for an entry directly in Twig, the same experience `WebpackEncoreBundle`_ gives you
with ``encore_entry_script_tags`` and ``encore_entry_link_tags``.

Five Twig functions come with it:

.. code-block:: twig

    {# templates/base.html.twig #}
    <!DOCTYPE html>
    <html>
        <head>
            <meta charset="UTF-8">
            <title>{% block title %}Welcome!{% endblock %}</title>
            <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 128 128%22><text y=%221.2em%22 font-size=%2296%22>⚫️</text><text y=%221.3em%22 x=%220.2em%22 font-size=%2276%22 fill=%22%23fff%22>sf</text></svg>">
            {% block stylesheets %}
                {{ reprise_entry_link_tags('app') }}
            {% endblock %}

            {% block javascripts %}
                {# reprise_entry_script_tags renders <script type="module"> (ESM output from both Vite and Rsbuild) #}
                {{ reprise_entry_script_tags('app') }}
            {% endblock %}
        </head>
        <body>
            {% block body %}{% endblock %}
        </body>
    </html>

``reprise_entry_js_files('app')`` and ``reprise_entry_css_files('app')`` are the same lookup, minus the HTML: they
return the raw URL lists, for the rare case where you need the paths rather than the tags.

``reprise_entry_exists('checkout')`` returns ``true`` when the named entry is present in ``entrypoints.json`` and
``false`` otherwise. Use it to guard a page-specific or optional entry so rendering its tags doesn't error in strict
mode:

.. code-block:: twig

    {% if reprise_entry_exists('checkout') %}
        {{ reprise_entry_script_tags('checkout') }}
    {% endif %}

If you're migrating from Webpack Encore, it's a tag-for-tag swap (Reprise is Encore's heritage, so the template
shape hasn't changed):

===================================  ====================================  ================================
Webpack Encore                       Symfony Reprise                       Output
===================================  ====================================  ================================
``encore_entry_link_tags('app')``    ``reprise_entry_link_tags('app')``    ``<link rel="stylesheet">`` tags
``encore_entry_script_tags('app')``  ``reprise_entry_script_tags('app')``  ``<script type="module">`` tags
``encore_entry_css_files('app')``    ``reprise_entry_css_files('app')``    CSS URL list
``encore_entry_js_files('app')``     ``reprise_entry_js_files('app')``     JS URL list
``encore_entry_exists('app')``       ``reprise_entry_exists('app')``       ``true``/``false``
===================================  ====================================  ================================

``reprise_entry_script_tags`` and ``reprise_entry_link_tags`` take a fourth ``attributes`` argument, merged over the
global ``script_attributes``/``link_attributes`` (per-call wins, ``false`` drops the attribute). It mirrors Encore's
fourth argument; since it follows the optional package name, pass it as a Twig named argument:

.. code-block:: twig

    {# a fourth `attributes` argument, merged over the configured script_attributes/link_attributes #}
    {{ reprise_entry_script_tags('app', attributes={ 'data-turbo-track': 'reload' }) }}
    {{ reprise_entry_link_tags('app', attributes={ media: 'print' }) }}

**Nothing to set up for the common case.** The tags resolve against Symfony's default asset package, so a standard
project needs nothing beyond installing the bundle (see `Configuration`_ below for the options). The snippet is the
same whether Vite or Rsbuild produced ``entrypoints.json``, and there's nothing to configure for dev either: in dev
``reprise_entry_script_tags`` injects the Vite HMR client automatically, while under Rsbuild the client is compiled
into the bundle.

Customizing rendered tags
-------------------------

Before Reprise writes any ``<script>`` or ``<link>`` tag (entry files, CSS, and the dev-server tags it injects itself,
like the Vite HMR client and the React Fast Refresh preamble), it dispatches a ``RenderAssetTagEvent``.
A listener can read and mutate ``$event->attributes`` to add, change, or remove attributes on that tag.

As one example, stamping a Content-Security-Policy nonce on every tag::

    namespace App\EventListener;

    use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
    use Symfony\Reprise\Event\RenderAssetTagEvent;

    #[AsEventListener]
    final class CspNonceListener
    {
        public function __construct(private NonceGenerator $nonceGenerator)
        {
        }

        public function __invoke(RenderAssetTagEvent $event): void
        {
            $event->attributes['nonce'] = $this->nonceGenerator->getNonce();
        }
    }

Features
--------

The rest of what Reprise carries over from Encore is opt-in. Turn on each feature through the plugin options in your
``vite.config.ts`` or ``rsbuild.config.ts``, and leave out the ones you don't need.

Symfony UX / Stimulus controllers
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This is the Vite/Rsbuild counterpart of what `@symfony/stimulus-bridge`_ did for Webpack Encore: it turns your
``controllers.json`` into a Stimulus application, with the same enable step, same helper, same local-controllers
convention.

Enable it by pointing the plugin at your ``controllers.json`` (this is what turns the feature on):

.. code-block:: javascript

    Symfony({
      stimulus: 'assets/controllers.json',
    })
    // or, to override the local controllers dir:
    Symfony({
      stimulus: {
        controllersJson: 'assets/controllers.json',
        controllersDir: 'assets/controllers',
      },
    })

Then start the app from your entry:

.. code-block:: javascript

    import { startStimulusApp } from '@symfony/reprise/stimulus'

    const app = startStimulusApp()

**Local controllers.** Any ``assets/controllers/*_controller.{js,ts}`` is registered automatically. The filename
becomes the identifier (``hello_controller.js`` becomes ``hello``, ``admin/user_controller.js`` becomes
``admin--user``). To load a controller on demand, put a ``stimulusFetch: 'lazy'`` comment directly above the
class; a block or a single-line comment both work.

.. code-block:: javascript

    import { Controller } from '@hotwired/stimulus'

    /* stimulusFetch: 'lazy' */
    export default class extends Controller {}

(``// stimulusFetch: 'lazy'`` on the line above the class works too, as does a preserved
``/*! stimulusFetch: 'lazy' */`` comment: the form tsc and esbuild keep through minification.)

**Third-party UX packages.** Controllers declared in ``controllers.json`` are resolved from ``node_modules``, so
install them with your package manager, the same as you would with Webpack Encore. For example, with Stimulus and
UX Leaflet Map:

.. code-block:: terminal

    $ npm install @hotwired/stimulus @symfony/ux-leaflet-map

Some packages need a bit of bundler-specific setup on top, the same way they did under Webpack Encore. UX Leaflet
Map, for instance, ships a CSS file meant for Webpack's loader and needs an alias to the plain CSS build:

.. code-block:: javascript

    // vite.config.ts
    export default defineConfig({
      // ...
      resolve: {
        alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
        },
      },
    })

Check each package's own docs for this kind of tweak.

File copy
~~~~~~~~~

Some assets aren't imported from JavaScript or CSS at all: they're referenced by a stable path straight from your
templates, like ``{{ asset('build/images/logo.svg') }}``. Point ``copy`` at the directories that hold them and
Reprise copies each file into the build and records it in ``manifest.json``. Once Symfony is pointed at that
manifest (below), the ``asset()`` helper resolves the logical path to the hashed URL:

.. code-block:: javascript

    // vite.config.ts
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig({
      // ...
      plugins: [
        Symfony({
          copy: [
            {
              from: 'assets/images',
              to: 'images',
            },
          ],
        }),
      ],
    })

.. code-block:: javascript

    // rsbuild.config.ts
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig({
      // ...
      plugins: [
        Symfony({
          copy: [
            {
              from: 'assets/images',
              to: 'images',
            },
          ],
        }),
      ],
    })

``from`` and ``to`` are both required: ``from`` is the source directory (relative to your project root), ``to`` is
the destination prefix used for the manifest key. Pass an empty ``to`` to copy the files at the root of
``outputPath``, for things like ``favicon.ico`` or ``site.webmanifest`` that have to live at a fixed URL. Restrict
which files are copied with ``pattern``, a regular expression tested against each file's path relative to ``from``
(by default every file is copied). ``includeSubdirectories`` defaults to ``true``; set it to ``false`` to turn off
recursion.

Some copied files have to keep a stable path on disk: templates referencing them through a hardcoded
``asset('/build/images/logo.svg')``, code reading them from a predictable location, CDN rules, and so on. Set
``hash: false`` on the entry and the file keeps its logical path. The content hash then moves to the
``manifest.json`` value as a query string, so cache-busting through ``asset()`` still works:

.. code-block:: javascript

    copy: [
      {
        from: 'assets/images',
        to: 'images',
        hash: false,
      },
    ],

.. code-block:: json

    { "build/images/logo.svg": "/build/images/logo.svg?87dcc351" }

Be aware that proxies or CDNs configured to ignore query strings will not pick up new versions of these files.
That is why hashed filenames remain the default.

How copied files are handled depends on the mode:

- **Build**: each file gets a content hash in its filename for cache busting, unless the entry sets ``hash: false``.
- **Dev**: files are copied verbatim, no hash.

Either way they land in ``public/build`` and are served by the Symfony web server, not the Vite/Rsbuild dev server,
so they're available whether or not the dev server is running.

For ``asset()`` to return the hashed URL, point Symfony's asset component at the generated ``manifest.json`` with
``framework.assets.json_manifest_path``:

.. code-block:: yaml

    # config/packages/framework.yaml
    framework:
        assets:
            json_manifest_path: '%kernel.project_dir%/public/build/manifest.json'

This is Symfony's native manifest support, the same setting Webpack Encore relies on, so it applies to every logical
asset reference, not just copied files. The entry references that ``RepriseBundle`` renders already carry their hash
and aren't manifest keys, so they pass through untouched.

By default the lookup is lenient: a reference missing from the manifest is returned unchanged. Set
``framework.assets.strict_mode: true`` to fail loudly on an unknown reference instead. Under strict mode, the entry
references ``RepriseBundle`` renders would be rejected too, so route them through a package that skips the manifest:
set ``reprise.asset_package`` to a package with ``version: false`` (see `Configuration`_) and keep
``json_manifest_path`` on the default package for your other assets.

Using a CDN
~~~~~~~~~~~

To serve your built assets from a CDN, set ``publicPath`` to the absolute CDN URL, for the production build only. In
dev, the dev server serves assets directly, so keep the local ``/build/`` path there. Both bundlers expose the mode
through the function form of their config, so switch on ``command === 'build'``:

.. code-block:: javascript

    // vite.config.ts  (command is 'serve' or 'build')
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig(({ command }) => ({
      // ...
      plugins: [
        Symfony({
          publicPath:
            command === 'build'
              ? 'https://my-cool-app.com.global.prod.fastly.net/build/'
              : '/build/',
          manifestKeyPrefix: 'build/',
        }),
      ],
    }))

.. code-block:: javascript

    // rsbuild.config.ts  (command is 'dev' or 'build')
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig(({ command }) => ({
      // ...
      plugins: [
        Symfony({
          publicPath:
            command === 'build'
              ? 'https://my-cool-app.com.global.prod.fastly.net/build/'
              : '/build/',
          manifestKeyPrefix: 'build/',
        }),
      ],
    }))

With an absolute ``publicPath``, ``manifestKeyPrefix`` is **required**: Reprise has no way to guess the right prefix
for the ``manifest.json`` keys, and throws a clear error if it's missing. Keys stay logical, values point at the
CDN:

.. code-block:: json

    {
      "build/app.js": "https://my-cool-app.com.global.prod.fastly.net/build/app-1a2b3c.js"
    }

``entrypoints.json`` is rewritten the same way, so the ``<script>`` and ``<link>`` tags render with CDN URLs. You
still have to upload the built files to the CDN yourself, or set up origin pull. For a CDN subdirectory, include it
in the URL (``https://my-cool-app.com.global.prod.fastly.net/awesome-website/build/``).

Subresource Integrity
~~~~~~~~~~~~~~~~~~~~~~~

When enabled, Reprise adds an ``integrity`` map to ``entrypoints.json`` (asset URL -> SRI hash). ``RepriseBundle``
reads that map and renders ``integrity="..."`` on the generated ``<script>`` and ``<link>`` tags, so the browser
refuses any asset whose bytes were tampered with.

The ``integrity`` option takes an object ``{ enabled, algorithms? }``. It only makes sense for the production build:
the dev server serves changing in-memory assets, so no hashes are emitted in dev. As with the CDN example, toggle it
with ``command === 'build'``:

.. code-block:: javascript

    // vite.config.ts  (command is 'serve' or 'build')
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig(({ command }) => ({
      // ...
      plugins: [
        Symfony({
          integrity: {
            enabled: command === 'build',
            algorithms: ['sha384'],
          },
        }),
      ],
    }))

.. code-block:: javascript

    // rsbuild.config.ts  (command is 'dev' or 'build')
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig(({ command }) => ({
      // ...
      plugins: [
        Symfony({
          integrity: {
            enabled: command === 'build',
            algorithms: ['sha384'],
          },
        }),
      ],
    }))

``algorithms`` is optional and defaults to ``['sha384']``. Accepted values are ``'sha256'``, ``'sha384'`` and
``'sha512'``. Passing several (e.g. ``['sha256', 'sha512']``) writes multiple space-separated hashes per file, which
the browser treats as "any one of these must match".

The resulting ``entrypoints.json`` gets an extra ``integrity`` section:

.. code-block:: json

    {
      "integrity": {
        "/build/app-1a2b3c.js": "sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K...",
        "/build/app-4d5e6f.css": "sha384-9ehJ4G8v3aQ2p1o0..."
      }
    }

Hashes cover every referenced file in each entry (js, css, and preloaded/dynamic chunks), and since they're computed
from the files actually written to disk, they stay correct through minification and hashing.

Multiple builds
~~~~~~~~~~~~~~~

Several areas of one app (a public part, an admin panel) are usually just separate entry points in one config: the
Multiple entries case, addressed by name without a ``build`` argument. Reach for multiple builds only when a part
needs its own bundler config and output directory, like an embeddable widget built apart from the main app.

Give the widget its own config, pointing the plugin at a separate output directory -> with Vite:

.. code-block:: javascript

    // vite.config.widget.ts  -- run with `vite build --config vite.config.widget.ts`
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig({
      input: {
        widget: './assets/widget.js',
      },
      plugins: [
        Symfony({
          outputPath: 'public/widget-build',
          publicPath: '/widget-build/',
        }),
      ],
    })

or with Rsbuild:

.. code-block:: javascript

    // rsbuild.config.widget.ts  -- run with `rsbuild build --config rsbuild.config.widget.ts`
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig({
      source: {
        entry: {
          widget: './assets/widget.js',
        },
      },
      plugins: [
        Symfony({
          outputPath: 'public/widget-build',
          publicPath: '/widget-build/',
        }),
      ],
    })

These two blocks are alternatives: pick the one that matches your bundler, you don't use both in one project.

Name that directory in ``reprise.yaml``:

.. code-block:: yaml

    # config/packages/reprise.yaml
    reprise:
        # the main app (your existing config), addressed without a build name
        output_path: '%kernel.project_dir%/public/build'
        builds:
            # each extra build: name -> the directory its entrypoints.json lives in
            widget: '%kernel.project_dir%/public/widget-build'

In Twig, pass the build name to load from it; omit it for the default build:

.. code-block:: twig

    {# the main app (default build) #}
    {{ reprise_entry_script_tags('app') }}
    {{ reprise_entry_link_tags('app') }}

    {# the widget build, selected with the build argument #}
    {{ reprise_entry_script_tags('widget', build='widget') }}
    {{ reprise_entry_link_tags('widget', build='widget') }}

The ``build`` argument works on every ``reprise_entry_*`` function. Each build has its own dev server, so the app's
and the widget's can run at once on different ports, each injecting its HMR client once. Set ``output_path: false``
for a named-builds-only setup (at least one build is required).

Configuration
-------------

Reprise exposes a few optional settings under its own configuration, all shown here at their default value:

.. code-block:: yaml

    # config/packages/reprise.yaml
    reprise:
        # Directory the @symfony/reprise plugin writes entrypoints.json and manifest.json into.
        # Set to false when using only named builds (requires at least one entry under builds).
        output_path: '%kernel.project_dir%/public/build'

        # Additional named builds: a map of build name -> output directory (see `Multiple builds`_).
        builds: {}

        # Throw when entrypoints.json or a requested entry is missing, instead of rendering nothing.
        strict_mode: true

        # Cache the parsed entrypoints.json in a compiled PHP file, warmed at cache:warmup (needs symfony/cache).
        cache: false

        # A framework.assets package name used to resolve entry URLs. null uses the default package.
        asset_package: null

        # crossorigin attribute set alongside SRI integrity: false, 'anonymous' or 'use-credentials'.
        crossorigin: false

        # Register rendered assets as WebLink HTTP/2 Link: preload headers (needs symfony/web-link).
        preload: true

        # Default attributes added to every rendered <script> / <link> tag.
        script_attributes: []
        link_attributes: []

- ``output_path``: filesystem directory holding ``entrypoints.json`` and ``manifest.json``. Must match the plugin's
  own ``outputPath``. Accepts ``false`` to disable the default build entirely (requires at least one entry under
  ``builds``).
- ``builds``: a map of build name -> output directory for additional bundles. Each named build is addressed by passing
  ``build='<name>'`` to the tag and file functions. See `Multiple builds`_.
- ``strict_mode``: when ``true`` (the default), throws a clear exception on a missing file or an unknown entry; when
  ``false``, renders nothing instead.
- ``cache``: when ``true``, parse ``entrypoints.json`` once at ``cache:warmup`` and read it from a compiled PHP file
  at runtime instead of decoding the JSON on every request. Enable it in production and run ``cache:clear`` after
  rebuilding your assets; it needs ``symfony/cache`` (``composer require symfony/cache``).
- ``asset_package``: resolve entry URLs through a specific ``framework.assets`` package instead of the default one.
  You only need this if your default package applies a version strategy, which would re-hash files Reprise already
  content-hashed and break the URLs. Point it at a package with ``version: false`` (see below).
- ``crossorigin``: ``false``, ``'anonymous'`` or ``'use-credentials'`` (any other value is a configuration error),
  applied together with SRI integrity (see `Subresource Integrity`_).
- ``preload``: emit WebLink HTTP/2 ``Link:`` preload headers when `symfony/web-link`_ is installed; ``false`` to
  disable.
- ``script_attributes`` / ``link_attributes``: maps of default attributes added to every generated tag, e.g.
  ``defer: true`` or ``data-turbo-track: reload``.

If you set ``asset_package``, define that package with ``version: false``:

.. code-block:: yaml

    reprise:
        asset_package: reprise

    framework:
        assets:
            packages:
                reprise:
                    version: false

Migrating from Webpack Encore
-----------------------------

Reprise is Webpack Encore's successor for Vite and Rsbuild, so the move splits in two. The Symfony side (the bundle
and your Twig templates) barely changes. Your ``webpack.config.js`` mostly goes away: Vite and Rsbuild do natively
what most ``Encore.*`` calls set up, so you delete those calls rather than translate them. What is left maps to a
Reprise plugin option or a bundler plugin.

The Symfony side
~~~~~~~~~~~~~~~~

Reprise ships its own ``RepriseBundle`` and does not use `WebpackEncoreBundle`_, so swap the Composer package:

.. code-block:: terminal

    $ composer remove symfony/webpack-encore-bundle
    $ composer require symfony/reprise

In your templates the Twig functions keep the same shape, with the ``encore_`` prefix becoming ``reprise_`` (the full
list is under `Rendering asset tags`_):

.. code-block:: twig

    {# before #}
    {{ encore_entry_link_tags('app') }}
    {{ encore_entry_script_tags('app') }}

    {# after #}
    {{ reprise_entry_link_tags('app') }}
    {{ reprise_entry_script_tags('app') }}

The bundle config carries over almost key-for-key: ``webpack_encore.output_path`` becomes ``reprise.output_path``,
and ``crossorigin``, ``preload``, ``cache``, ``strict_mode``, ``script_attributes`` and ``link_attributes`` all exist
under ``reprise`` with the same meaning. Encore's ``builds`` option maps to `Multiple builds`_.

Your build config
~~~~~~~~~~~~~~~~~

Most of ``webpack.config.js`` has no equivalent, because the bundler already does the work. The Symfony glue Encore
layered on top of Webpack stays, as a Reprise plugin option:

=========================================  ============================================================================================
Webpack Encore                             Reprise
=========================================  ============================================================================================
``setOutputPath()`` / ``setPublicPath()``  plugin ``outputPath`` / ``publicPath`` (the defaults fit a standard project)
``setManifestKeyPrefix()``                 plugin ``manifestKeyPrefix`` (see `Using a CDN`_)
``addEntry()`` / ``addEntries()``          Vite ``input`` (Vite 8.1 and older: ``build.rollupOptions.input``); Rsbuild ``source.entry``
``enableVersioning()``                     nothing to do, content hashing is on by default
``enableIntegrityHashes()``                plugin ``integrity: { enabled: true }`` (see `Subresource Integrity`_)
``copyFiles()``                            plugin ``copy: [ ... ]`` (see `File copy`_)
``enableStimulusBridge()``                 plugin ``stimulus: 'assets/controllers.json'`` (see `Symfony UX / Stimulus controllers`_)
``configureDevServerOptions()``            nothing to do: run ``vite`` or ``rsbuild dev`` and Reprise points Twig at it
=========================================  ============================================================================================

Everything Vite and Rsbuild handle themselves, you drop:

===================================================================================  ====================================================================================================================
Webpack Encore                                                                       Now handled by the bundler
===================================================================================  ====================================================================================================================
``enableSassLoader()`` / ``enableLessLoader()`` / ``enableStylusLoader()``           install the preprocessor and import the file (Vite out of the box, Rsbuild via ``@rsbuild/plugin-sass`` and friends)
``enablePostCssLoader()``                                                            add a ``postcss.config.js``, picked up automatically
``enableTypeScriptLoader()`` / ``configureBabel()`` / ``configureBabelPresetEnv()``  native transpilation (Vite via esbuild, Rsbuild via SWC); set targets with ``browserslist`` or ``build.target``
``enableForkedTypeScriptTypesChecking()`` / ``enableBabelTypeScriptPreset()``        run ``tsc --noEmit`` (or ``vue-tsc``) as its own script, outside the build
``splitEntryChunks()`` / ``configureSplitChunks()`` / ``addCacheGroup()``            native code splitting
``enableSingleRuntimeChunk()`` / ``disableSingleRuntimeChunk()``                     native runtime chunk management
``enableSourceMaps()``                                                               native (Vite ``build.sourcemap``)
``configureImageRule()`` / ``configureFontRule()`` / ``configureFilenames()``        native asset handling and output naming
``addStyleEntry()``                                                                  add the stylesheet as an entry input, or import it from a JS entry
``configureDefinePlugin()``                                                          Vite ``define``, Rsbuild ``source.define``
``disableCssExtraction()`` / ``configureCssLoader()`` / ``configureStyleLoader()``   native CSS handling (extraction, minification)
``addAliases()``                                                                     ``resolve.alias``
``addExternals()``                                                                   Vite ``build.rollupOptions.external``, Rsbuild ``output.externals``
``enableBuildCache()`` / ``configureWatchOptions()``                                 native build caching and watch
``cleanupOutputBeforeBuild()``                                                       native (Vite ``build.emptyOutDir``, Rsbuild cleans by default)
===================================================================================  ====================================================================================================================

Framework presets become the bundler's own plugin:

========================  ================================  ==========================
Webpack Encore            Vite                              Rsbuild
========================  ================================  ==========================
``enableReactPreset()``   ``@vitejs/plugin-react``          ``@rsbuild/plugin-react``
``enableVueLoader()``     ``@vitejs/plugin-vue``            ``@rsbuild/plugin-vue``
``enablePreactPreset()``  ``@preact/preset-vite``           ``@rsbuild/plugin-preact``
``enableSvelte()``        ``@sveltejs/vite-plugin-svelte``  ``@rsbuild/plugin-svelte``
========================  ================================  ==========================

A few Encore features have no direct replacement:

- ``autoProvideVariables()`` / ``autoProvidejQuery()``: prefer importing what you use. To inject a global anyway, use
  ``@rollup/plugin-inject`` under Vite or ``rspack.ProvidePlugin`` (through Rsbuild's ``tools.rspack``).
- ``enableBuildNotifications()`` and the ESLint integration are gone: run your linter as its own script, outside the
  build.
- ``Encore.isProduction()`` / ``isDev()`` / ``isDevServer()`` / ``when()``: branch on the bundler mode instead, e.g.
  ``defineConfig(({ command }) => ...)`` where ``command`` is ``'build'`` or the dev command.
- ``addLoader()`` / ``addRule()`` / ``addPlugin()`` / ``configureLoaderRule()``: these were escape hatches into the
  raw Webpack config; edit the bundler config directly (Vite ``plugins``, Rsbuild ``tools.rspack``).
- ``enableHandlebarsLoader()``: add the bundler's own Handlebars plugin if you still need it.
- ``configureRuntimeEnvironment()`` / ``clearRuntimeEnvironment()`` / ``isRuntimeEnvironmentConfigured()`` /
  ``reset()``: Encore's own bootstrap and reset plumbing, no counterpart here.
- The remaining ``configure*Plugin()`` calls (``configureManifestPlugin()``, ``configureMiniCssExtractPlugin()``,
  ``configureCssMinimizerPlugin()``, ``configureJsMinimizerPlugin()``, ``configureFriendlyErrorsPlugin()``): tuned
  Webpack internals that Reprise and the bundlers now own; nothing to port.

Backward Compatibility promise
------------------------------

This bundle aims at following the same Backward Compatibility promise as the Symfony framework:
https://symfony.com/doc/current/contributing/code/bc.html

.. _Vite: https://vite.dev/
.. _Rsbuild: https://rsbuild.dev/
.. _`@symfony/stimulus-bridge`: https://github.com/symfony/stimulus-bridge
.. _WebpackEncoreBundle: https://github.com/symfony/webpack-encore-bundle
.. _`symfony/web-link`: https://symfony.com/doc/current/web_link.html
