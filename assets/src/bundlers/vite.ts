import type { UnpluginOptions } from 'unplugin';
import type { CopyResult } from '../core/copy';
import type { NormalizedGraph, ResolvedOptions } from '../types';
import { bundleToGraph, configToDevGraph } from '../collectors/vite';
import { resolveCopyFiles, writeDevCopyFiles } from '../core/copy';
import { resolveDevOrigin } from '../core/dev-server';
import { writeMetadata } from '../core/emit';
import { resolvePublicPath } from '../core/options';
import { affectsControllersModule, RESOLVED_VIRTUAL_CONTROLLERS_ID } from '../core/stimulus';

export function viteHooks(resolved: ResolvedOptions, state: { isDev: boolean }): NonNullable<UnpluginOptions['vite']> {
    // Vite project root (from `configResolved`); keys imported assets in `bundleToGraph`.
    let root: string;
    // The Symfony files are written in `writeBundle`; stash what they need.
    let pending: { graph: NormalizedGraph; copyFiles: CopyResult[] } | null = null;

    return {
        config: () => ({
            base: resolved.publicPath,
            build: {
                outDir: resolved.outputPath,
                copyPublicDir: false,
                manifest: false,
                assetsDir: '.',
            },
        }),

        generateBundle(_outputOptions, bundle) {
            const graph = bundleToGraph(bundle, root);
            const copyFiles = resolveCopyFiles(resolved.copy);
            for (const file of copyFiles) {
                this.emitFile({ type: 'asset', fileName: file.physicalName, source: file.source });
            }
            // Vite finalizes chunk bytes only on disk write (replacing markers like `__VITE_PRELOAD__`),
            // so the in-memory bundle differs from the file — hash for SRI in `writeBundle`, not here.
            pending = { graph, copyFiles };
        },

        writeBundle() {
            if (!pending) return;
            const { graph, copyFiles } = pending;
            pending = null;
            writeMetadata(resolved, graph, { isProd: true, devServer: null, copyFiles });
        },

        configResolved(config) {
            state.isDev = config.command === 'serve';
            root = config.root;
        },

        configureServer(server) {
            const stimulus = resolved.stimulus;
            if (stimulus) {
                // `addWatchFile()` can't cover a controller that doesn't exist yet.
                server.watcher.add([stimulus.controllersJson, ...Object.values(stimulus.controllersDirs)]);
                server.watcher.on('all', (_event, file) => {
                    if (!affectsControllersModule(file, stimulus)) return;
                    const client = server.environments.client;
                    const mod = client.moduleGraph.getModuleById(RESOLVED_VIRTUAL_CONTROLLERS_ID);
                    if (mod) client.moduleGraph.invalidateModule(mod);
                    client.hot.send({ type: 'full-reload' });
                });
            }

            // Middleware mode has no `httpServer`; only the standalone dev server is supported.
            server.httpServer?.once('listening', () => {
                const address = server.httpServer?.address();
                if (!address || typeof address === 'string') return;

                const origin = resolveDevOrigin(address, {
                    override: resolved.devServerOrigin,
                    serverOrigin: server.config.server.origin,
                    https: Boolean(server.config.server.https),
                });
                server.config.server.origin = origin; // keep Vite's internal URL rewriting in sync

                // Vite serves `@vite/client` (and `@react-refresh`) under `base` (publicPath), not
                // at the origin root.
                const urlPrefix = resolvePublicPath(resolved.publicPath, origin);
                // `@vitejs/plugin-react` (and `-react-swc`) register plugins named `vite:react-*`.
                // When present, Symfony must emit the Fast Refresh preamble itself (it can't touch the HTML).
                const usesReactPlugin = server.config.plugins.some((plugin) => plugin.name?.startsWith('vite:react'));
                const devServer = {
                    origin,
                    client: `${urlPrefix}@vite/client`,
                    reactRefresh: usesReactPlugin ? `${urlPrefix}@react-refresh` : null,
                };
                try {
                    const copyFiles = writeDevCopyFiles(resolved.copy, resolved.outputPath);
                    writeMetadata(resolved, configToDevGraph(server.config), {
                        isProd: false,
                        devServer,
                        copyFiles,
                    });
                } catch (err) {
                    server.config.logger.error(
                        `[@symfony/reprise] failed to write dev entrypoints.json: ${err instanceof Error ? err.message : String(err)}`
                    );
                }
            });
        },
    };
}
