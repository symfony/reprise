import type { Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { bundleToGraph, configToDevGraph } from '../../src/collectors/vite';

function chunk(partial: Partial<Rollup.OutputChunk> & { fileName: string; name: string; isEntry: boolean }): any {
    return {
        type: 'chunk',
        imports: [],
        dynamicImports: [],
        code: 'export {};',
        ...partial,
    };
}

function asset(fileName: string, names: string[], originalFileNames: string[] = []): any {
    return { type: 'asset', fileName, names, originalFileNames, source: '' };
}

describe('bundleToGraph', () => {
    it('extracts entry js, css, preload and dynamic from entry chunks', () => {
        const bundle = {
            'app-a1b2.js': {
                ...chunk({
                    fileName: 'app-a1b2.js',
                    name: 'app',
                    isEntry: true,
                    imports: ['vendor-e5.js'],
                    dynamicImports: ['lazy-x.js'],
                }),
                viteMetadata: { importedCss: new Set(['app-c3.css']), importedAssets: new Set() },
            },
            'admin-99.js': chunk({ fileName: 'admin-99.js', name: 'admin', isEntry: true }),
            'vendor-e5.js': chunk({ fileName: 'vendor-e5.js', name: 'vendor', isEntry: false }),
            'lazy-x.js': chunk({ fileName: 'lazy-x.js', name: 'lazy-x', isEntry: false }),
            'app-c3.css': asset('app-c3.css', ['app.css']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.entryPoints.app).toEqual({
            js: ['app-a1b2.js'],
            css: ['app-c3.css'],
            preload: ['vendor-e5.js'],
            dynamic: ['lazy-x.js'],
        });
        expect(graph.entryPoints.admin).toEqual({ js: ['admin-99.js'], css: [], preload: [], dynamic: [] });
        expect(graph.entryPoints.vendor).toBeUndefined();
    });

    it('drops a CSS-only dynamic import whose chunk was pruned to empty JS', () => {
        // `import('x.css')` yields a chunk rolldown-vite empties (code === '') and never writes; its name
        // still shows in dynamicImports. It must be dropped, and its async CSS kept out of the manifest.
        const bundle = {
            'app.js': {
                ...chunk({ fileName: 'app.js', name: 'app', isEntry: true, dynamicImports: ['lazy-css.js'] }),
                viteMetadata: { importedCss: new Set<string>(), importedAssets: new Set() },
            },
            'lazy-css.js': {
                ...chunk({ fileName: 'lazy-css.js', name: 'lazy-css', isEntry: false, code: '' }),
                viteMetadata: { importedCss: new Set(['lazy-css.css']), importedAssets: new Set() },
            },
            'lazy-css.css': asset('lazy-css.css', ['lazy-css.css']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.entryPoints.app.dynamic).toEqual([]);
        expect(graph.assets.some((a) => a.fileName === 'lazy-css.css')).toBe(false);
    });

    it('collects entry CSS from a facade chunk that only re-imports the real chunk', () => {
        // Rollup emits a thin *facade* entry (e.g. when the entry uses top-level await) that just re-imports
        // the real chunk; the CSS then rides on that statically-imported chunk, not the facade itself.
        const bundle = {
            'app-facade.js': {
                ...chunk({
                    fileName: 'app-facade.js',
                    name: 'app',
                    isEntry: true,
                    imports: ['app-real.js'],
                }),
                viteMetadata: { importedCss: new Set<string>(), importedAssets: new Set() },
            },
            'app-real.js': {
                ...chunk({ fileName: 'app-real.js', name: 'app', isEntry: false }),
                viteMetadata: { importedCss: new Set(['app-c3.css']), importedAssets: new Set() },
            },
            'app-c3.css': asset('app-c3.css', ['app.css']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.entryPoints.app).toEqual({
            js: ['app-facade.js'],
            css: ['app-c3.css'],
            preload: ['app-real.js'],
            dynamic: [],
        });
        // The facade's CSS must stay in the manifest (keyed by name), not be dropped as async chunk CSS.
        expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app-c3.css' });
    });

    it('collects entry CSS transitively through a chain of statically imported chunks', () => {
        // entry -> mid -> leaf, with CSS on both the mid and the (deepest) leaf chunk. The walk must
        // follow imports to any depth, not just the entry's direct imports.
        const bundle = {
            'app.js': {
                ...chunk({ fileName: 'app.js', name: 'app', isEntry: true, imports: ['mid.js'] }),
                viteMetadata: { importedCss: new Set<string>(), importedAssets: new Set() },
            },
            'mid.js': {
                ...chunk({ fileName: 'mid.js', name: 'mid', isEntry: false, imports: ['leaf.js'] }),
                viteMetadata: { importedCss: new Set(['mid.css']), importedAssets: new Set() },
            },
            'leaf.js': {
                ...chunk({ fileName: 'leaf.js', name: 'leaf', isEntry: false }),
                viteMetadata: { importedCss: new Set(['leaf.css']), importedAssets: new Set() },
            },
            'mid.css': asset('mid.css', ['mid.css']),
            'leaf.css': asset('leaf.css', ['leaf.css']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.entryPoints.app.css).toEqual(['mid.css', 'leaf.css']);
        // Both stay in the manifest (keyed by name), not dropped as async chunk CSS.
        expect(graph.assets).toContainEqual({ logicalName: 'mid.css', fileName: 'mid.css' });
        expect(graph.assets).toContainEqual({ logicalName: 'leaf.css', fileName: 'leaf.css' });
    });

    it('collects manifest assets: entry chunks by "<name>.js" and assets by names[0] without a source path', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'app-c3.css': asset('app-c3.css', ['app.css']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'app.js', fileName: 'app-a1b2.js' });
        expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app-c3.css' });
    });

    it('falls back to fileName when an asset has no names', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'noname-x.png': asset('noname-x.png', []),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'noname-x.png', fileName: 'noname-x.png' });
    });

    it('keys imported assets by their source path relative to root (not the basename)', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'krkr-h.webp': asset('krkr-h.webp', ['krkr.webp'], ['/app/assets/images/krkr.webp']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'assets/images/krkr.webp', fileName: 'krkr-h.webp' });
    });

    it('gives same-basename assets from different directories distinct keys', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'pic-1.png': asset('pic-1.png', ['pic.png'], ['/app/a/pic.png']),
            'pic-2.png': asset('pic-2.png', ['pic.png'], ['/app/b/pic.png']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'a/pic.png', fileName: 'pic-1.png' });
        expect(graph.assets).toContainEqual({ logicalName: 'b/pic.png', fileName: 'pic-2.png' });
    });

    it('keeps entry CSS keyed by name, not by its importing chunk path', () => {
        const bundle = {
            'app-a1b2.js': {
                ...chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
                viteMetadata: { importedCss: new Set(['app-c3.css']), importedAssets: new Set() },
            },
            // Vite/rolldown reports the entry CSS's originalFileNames as the importing JS, which would
            // be a misleading manifest key — the entry-CSS branch must win over the source-path branch.
            'app-c3.css': asset('app-c3.css', ['app.css'], ['/app/assets/app.js']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app-c3.css' });
        expect(graph.assets.some((a) => a.logicalName === 'assets/app.js')).toBe(false);
    });

    it('drops async (non-entry) chunk CSS from the manifest (byproduct; avoids same-name collisions)', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            // Two lazily-imported controllers sharing a name (a local one and a package one) both emit
            // CSS named `map_controller.css`. Keeping them would collide on a single manifest key; they
            // load at runtime with their chunk, never via asset(), so drop them entirely.
            'localMap.js': {
                ...chunk({ fileName: 'localMap.js', name: 'map_controller', isEntry: false }),
                viteMetadata: { importedCss: new Set(['localMap.css']), importedAssets: new Set() },
            },
            'pkgMap.js': {
                ...chunk({ fileName: 'pkgMap.js', name: 'map_controller', isEntry: false }),
                viteMetadata: { importedCss: new Set(['pkgMap.css']), importedAssets: new Set() },
            },
            'localMap.css': asset(
                'localMap.css',
                ['map_controller.css'],
                ['/app/assets/controllers/map_controller.js']
            ),
            'pkgMap.css': asset(
                'pkgMap.css',
                ['map_controller.css'],
                ['/app/node_modules/@x/ux-map/dist/map_controller.js']
            ),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets.some((a) => a.fileName === 'localMap.css' || a.fileName === 'pkgMap.css')).toBe(false);
        expect(graph.assets.some((a) => a.logicalName === 'map_controller.css')).toBe(false);
    });
});

describe('configToDevGraph', () => {
    const config = {
        root: '/app',
        build: { rollupOptions: { input: { app: '/app/assets/app.js', theme: '/app/assets/theme.scss' } } },
    };

    it('maps object inputs to bare relative entry files, typed by extension', () => {
        const graph = configToDevGraph(config as any);
        expect(graph.entryPoints.app).toEqual({ js: ['assets/app.js'], css: [], preload: [], dynamic: [] });
        expect(graph.entryPoints.theme).toEqual({ js: [], css: ['assets/theme.scss'], preload: [], dynamic: [] });
        expect(graph.assets).toEqual([]);
    });

    it('ignores array/undefined inputs (named entries only)', () => {
        expect(
            configToDevGraph({ root: '/app', build: { rollupOptions: { input: ['/app/a.js'] } } } as any).entryPoints
        ).toEqual({});
        expect(configToDevGraph({ root: '/app', build: { rollupOptions: {} } } as any).entryPoints).toEqual({});
    });

    it('reads rolldownOptions.input when rollupOptions is absent (rolldown-vite)', () => {
        const graph = configToDevGraph({
            root: '/app',
            build: { rolldownOptions: { input: { app: '/app/assets/app.js' } } },
        } as any);
        expect(graph.entryPoints.app).toEqual({ js: ['assets/app.js'], css: [], preload: [], dynamic: [] });
    });

    it('reads the top-level input when nested build input is absent', () => {
        const graph = configToDevGraph({
            root: '/app',
            input: { app: '/app/assets/app.js' },
            build: {},
        });
        expect(graph.entryPoints.app).toEqual({ js: ['assets/app.js'], css: [], preload: [], dynamic: [] });
    });

    it('prefers nested build input over the top-level input', () => {
        const graph = configToDevGraph({
            root: '/app',
            input: { topLevel: '/app/assets/top-level.js' },
            build: { rolldownOptions: { input: { app: '/app/assets/app.js' } } },
        });
        expect(graph.entryPoints).toEqual({
            app: { js: ['assets/app.js'], css: [], preload: [], dynamic: [] },
        });
    });

    it('prefers rolldownOptions.input over the deprecated rollupOptions', () => {
        const graph = configToDevGraph({
            root: '/app',
            build: {
                rolldownOptions: { input: { app: '/app/assets/app.js' } },
                rollupOptions: { input: { legacy: '/app/assets/legacy.js' } },
            },
        } as any);
        expect(graph.entryPoints).toEqual({
            app: { js: ['assets/app.js'], css: [], preload: [], dynamic: [] },
        });
    });
});
