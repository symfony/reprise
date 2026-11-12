import type { UnpluginOptions } from 'unplugin';
import type { RspackEntry, RspackStats } from '../collectors/rspack';
import type { CopyResult } from '../core/copy';
import type { WatchIgnoreRule } from '../core/emit';
import type { ResolvedOptions } from '../types';
import { statsToGraph, styleEntryNames } from '../collectors/rspack';
import { resolveCopyFiles, writeCopyFiles } from '../core/copy';
import { resolveDevOrigin, urlHost } from '../core/dev-server';
import { watchIgnore, writeMetadata } from '../core/emit';
import { isAbsolutePublicPath, resolvePublicPath } from '../core/options';
import { slash } from '../core/paths';

type WatchIgnored = string | RegExp | string[] | ((path: string) => boolean);

export function mergeWatchIgnored(ignored: WatchIgnored | undefined, own: WatchIgnoreRule): WatchIgnored {
    if (ignored === undefined || ignored instanceof RegExp) {
        // Setting `ignored` replaces Rspack's default (node_modules, .git): extend it instead.
        const base = ignored ?? /[\\/](?:\.git|node_modules)[\\/]/;
        return new RegExp(`(?:${base.source})|${own.pattern.source}`, base.flags.replace(/[gy]/g, ''));
    }
    if (typeof ignored === 'function') {
        return (path: string) => ignored(path) || own.pattern.test(slash(path));
    }
    return [ignored, own.globs].flat();
}

export function rsbuildHooks(
    resolved: ResolvedOptions,
    state: { isDev: boolean }
): NonNullable<UnpluginOptions['rsbuild']> {
    return {
        // `@rsbuild/core` is an optional peer, so we never import it here (a static import would pull it
        // into the shared factory — and thus the Vite bundle — breaking Vite-only installs). The `rspack`
        // namespace we need for the copy tap is read off the compiler instance (`c.rspack`) instead.
        setup(api) {
            // Rsbuild's dev/build signal; feeds the shared `isDev` the universal `load` reads.
            const isDev = api.context.action === 'dev';
            state.isDev = isDev;
            const publicOrigin = resolved.devServerOrigin ? new URL(resolved.devServerOrigin) : null;

            // Symfony renders the HTML, so no per-entry HTML pages.
            api.modifyRsbuildConfig((config) => {
                config.tools ??= {};
                config.tools.htmlPlugin = false;
                config.output ??= {};
                const prevDistPath = typeof config.output.distPath === 'object' ? config.output.distPath : {};
                config.output.distPath = { ...prevDistPath, root: resolved.outputPath };
                // `outputPath` is inside Rsbuild's public dir; copying public/ into public/build/ (a subpath)
                // throws `ERR_FS_CP_EINVAL`. Disable the copy (the Rspack analog of Vite's `copyPublicDir: false`).
                config.server ??= {};
                config.server.publicDir = false;
                // Serve the dev server under `publicPath` so advertised URLs match (else every URL 404s).
                // `server.base` must be a slash-path, so an absolute (CDN) publicPath falls back to `/`.
                config.server.base = isAbsolutePublicPath(resolved.publicPath) ? '/' : resolved.publicPath;
                // Already defaulted to `/` by Rsbuild, so `??=` wouldn't apply — assign unconditionally.
                // Drives production asset URLs (dev uses `server.base` above).
                config.output.assetPrefix = resolved.publicPath;
                // Standardise on ESM so the tags render as `<script type="module">` like Vite.
                config.output.module = true;

                // The advertised dev host must be the one the server binds to: Rsbuild's default `localhost`
                // binds `::1` only, so a literal `127.0.0.1` isn't listening and refuses HMR/lazy/chunk requests.
                // Same wildcard/unset -> `localhost` mapping as the `done` tap, so client + origin stay in sync.
                const devHost = urlHost(typeof config.server.host === 'string' ? config.server.host : 'localhost');
                const secure = publicOrigin ? publicOrigin.protocol === 'https:' : Boolean(config.server.https);

                // Pin the HMR/lazy-compilation client to the dev server: by default it derives its WS URL from
                // `window.location` (the Symfony page) and 404s. `<port>` is substituted at server start; the
                // explicit protocol stops it inferring `wss` from an HTTPS page against a plain-HTTP dev server.
                config.dev ??= {};
                config.dev.client = {
                    ...config.dev.client,
                    host: publicOrigin?.hostname ?? devHost,
                    port: publicOrigin ? publicOrigin.port || (secure ? '443' : '80') : '<port>',
                    protocol: secure ? 'wss' : 'ws',
                };
                // Async chunk URLs come from `dev.assetPrefix` (default `/` -> 404 against the Symfony page).
                // It's used verbatim (no `server.base` composed in), so carry the full publicPath; skip CDN.
                if (!isAbsolutePublicPath(resolved.publicPath)) {
                    const origin = resolved.devServerOrigin ?? `${secure ? 'https' : 'http'}://${devHost}:<port>`;
                    config.dev.assetPrefix = resolvePublicPath(resolved.publicPath, origin);
                }

                // The Rspack-layer flags behind `output.module` above, so async chunks are `import()`ed.
                const prev = config.tools.rspack;
                const prevList = Array.isArray(prev) ? prev : prev ? [prev] : [];
                config.tools.rspack = [
                    ...prevList,
                    (rspackConfig) => {
                        rspackConfig.experiments ??= {};
                        // `outputModule` is a valid Rspack experiment but missing from its typings.
                        (rspackConfig.experiments as { outputModule?: boolean }).outputModule = true;
                        rspackConfig.output ??= {};
                        rspackConfig.output.module = true;
                        rspackConfig.output.chunkFormat = 'module';

                        // A tool watching outputPath's parent (Tailwind CSS v4 watches `public/`) would otherwise
                        // rebuild on every write of the Symfony files, forever.
                        rspackConfig.watchOptions ??= {};
                        rspackConfig.watchOptions.ignored = mergeWatchIgnored(
                            rspackConfig.watchOptions.ignored,
                            watchIgnore(resolved)
                        );
                    },
                ];
            });

            api.onAfterCreateCompiler(({ compiler }) => {
                const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                for (const c of compilers) {
                    // The normalized entry rather than `source.entry`: Rsbuild resolves and reshapes
                    // entries on the way to Rspack, and this is the form the stats keys match.
                    const styleEntries = styleEntryNames(c.options.entry as RspackEntry);
                    let copiedInBuild: CopyResult[] = [];

                    // Ahead of Rsbuild's own `done` taps, which read `hasErrors()` to report the build and settle it.
                    c.hooks.done.tap({ name: '@symfony/reprise', stage: -Infinity }, (stats) => {
                        // Derive the dev origin ourselves from `api.context.devServer` + our `publicPath`, rather
                        // than reading back `compiler.options.output.publicPath` (whose dev value depends on Rsbuild's merge).
                        const devServer = api.context.devServer;
                        const origin =
                            isDev && devServer
                                ? resolveDevOrigin(
                                      { address: devServer.hostname, port: devServer.port },
                                      { override: resolved.devServerOrigin, https: devServer.https }
                                  )
                                : null;
                        // Only what statsToGraph reads; `cachedAssets` keeps the files a watch rebuild didn't re-emit.
                        const graph = statsToGraph(
                            stats.toJson({
                                all: false,
                                // Dev leaves the bundler's assets out of the manifest.
                                assets: !isDev,
                                cachedAssets: !isDev,
                                entrypoints: true,
                            }) as RspackStats,
                            styleEntries
                        );
                        try {
                            let copyFiles = copiedInBuild;
                            if (isDev) {
                                copyFiles = resolveCopyFiles(resolved.copy, false);
                                writeCopyFiles(copyFiles, resolved.outputPath);
                            }
                            writeMetadata(resolved, graph, {
                                isProd: !isDev,
                                devServer: origin ? { origin, client: null } : null,
                                copyFiles,
                            });
                        } catch (err) {
                            const message = `[@symfony/reprise] failed to write entrypoints.json: ${err instanceof Error ? err.message : String(err)}`;
                            if (isDev) c.getInfrastructureLogger('@symfony/reprise').error(message);
                            else stats.compilation.errors.push(new Error(message));
                        }
                    });

                    if (isDev) continue;
                    // Build: emit copied files into the compilation so Rspack writes/cleans them and
                    // `sourceFilename` lets statsToGraph key them in the manifest. Dev writes them to disk in
                    // `done` instead (served by Symfony, not the dev server), so they aren't in-memory assets.
                    // Resolved per compilation, so a rebuild picks up edits to the copied files.
                    c.hooks.thisCompilation.tap('@symfony/reprise', (compilation) => {
                        compilation.hooks.processAssets.tap(
                            {
                                name: '@symfony/reprise:copy',
                                stage: c.rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                            },
                            () => {
                                copiedInBuild = resolveCopyFiles(resolved.copy, true);
                                for (const file of copiedInBuild) {
                                    compilation.emitAsset(
                                        file.physicalName,
                                        new c.rspack.sources.RawSource(file.source),
                                        { sourceFilename: file.logicalName }
                                    );
                                }
                            }
                        );
                        // Rspack emits a runtime-only JS file for a style entry; delete it so the build
                        // matches Vite, which prunes its equivalent. Dev keeps it: nothing reaches the disk
                        // there, and the file carries the entry's HMR runtime.
                        compilation.hooks.processAssets.tap(
                            {
                                name: '@symfony/reprise:style-entries',
                                stage: c.rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
                            },
                            () => {
                                for (const chunk of compilation.chunks) {
                                    if (!chunk.name || !styleEntries.has(chunk.name)) continue;
                                    for (const file of chunk.files) {
                                        if (file.endsWith('.js')) compilation.deleteAsset(file);
                                    }
                                    for (const file of chunk.auxiliaryFiles) {
                                        if (file.endsWith('.js.map')) compilation.deleteAsset(file);
                                    }
                                }
                            }
                        );
                    });
                }
            });
        },
    };
}
