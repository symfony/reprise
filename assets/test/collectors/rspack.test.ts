import { describe, expect, it } from 'vitest';
import { statsToGraph } from '../../src/collectors/rspack';

describe('statsToGraph', () => {
    it('extracts js/css per entry and skips hot-update files', () => {
        const graph = statsToGraph({
            entrypoints: {
                app: {
                    assets: [
                        { name: 'runtime.js' },
                        { name: 'app.a1.js' },
                        { name: 'app.b2.css' },
                        { name: 'app.c3.hot-update.js' },
                    ],
                },
                admin: { assets: [{ name: 'admin.d4.js' }] },
            },
        });
        expect(graph.entryPoints.app).toEqual({
            js: ['runtime.js', 'app.a1.js'],
            css: ['app.b2.css'],
            preload: [],
            dynamic: [],
        });
        expect(graph.entryPoints.admin).toEqual({ js: ['admin.d4.js'], css: [], preload: [], dynamic: [] });
    });

    it('builds manifest assets from assetsByChunkName and sourceFilename', () => {
        const graph = statsToGraph({
            entrypoints: {},
            assetsByChunkName: { app: ['app.a1.js', 'app.b2.css'] },
            assets: [{ name: 'logo.e5.svg', info: { sourceFilename: 'images/logo.svg' } }],
        });
        expect(graph.assets).toContainEqual({ logicalName: 'app.js', fileName: 'app.a1.js' });
        expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app.b2.css' });
        expect(graph.assets).toContainEqual({ logicalName: 'images/logo.svg', fileName: 'logo.e5.svg' });
    });

    it('strips a url() query or fragment from the manifest key', () => {
        const graph = statsToGraph({
            assets: [
                { name: 'font.e5.woff2', info: { sourceFilename: 'fonts/font.woff2?v=1' } },
                { name: 'icon.f6.svg', info: { sourceFilename: 'images/icon.svg#frag' } },
            ],
        });
        expect(graph.assets).toContainEqual({ logicalName: 'fonts/font.woff2', fileName: 'font.e5.woff2' });
        expect(graph.assets).toContainEqual({ logicalName: 'images/icon.svg', fileName: 'icon.f6.svg' });
    });

    it('tolerates empty/absent stats sections', () => {
        expect(statsToGraph({})).toEqual({ entryPoints: {}, assets: [] });
    });

    it('strips a query string or fragment before reading the extension', () => {
        const graph = statsToGraph({
            entrypoints: { app: { assets: [{ name: 'app.a1.js?v=1.2.3' }, { name: 'app.b2.css#frag' }] } },
        });
        expect(graph.entryPoints.app.js).toEqual(['app.a1.js?v=1.2.3']);
        expect(graph.entryPoints.app.css).toEqual(['app.b2.css#frag']);
    });
});

describe('statsToGraph with style entries', () => {
    const stats = {
        entrypoints: {
            theme: { assets: [{ name: 'theme.a1.js' }, { name: 'theme.b2.css' }] },
            mixed: { assets: [{ name: 'mixed.c3.js' }, { name: 'mixed.d4.css' }] },
            empty: { assets: [{ name: 'empty.e5.js' }] },
        },
        assetsByChunkName: {
            theme: ['theme.a1.js', 'theme.b2.css'],
            mixed: ['mixed.c3.js', 'mixed.d4.css'],
            empty: ['empty.e5.js'],
        },
    };
    const entryConfig = {
        theme: { import: ['/app/assets/styles/theme.scss'] },
        mixed: { import: ['/app/assets/admin.js', '/app/assets/admin.scss'] },
        empty: { import: [] },
    };

    it('drops the runtime-only js of a stylesheet entry from the entry and the manifest', () => {
        const graph = statsToGraph(stats, entryConfig);
        expect(graph.entryPoints.theme).toEqual({ js: [], css: ['theme.b2.css'], preload: [], dynamic: [] });
        expect(graph.assets).toContainEqual({ logicalName: 'theme.css', fileName: 'theme.b2.css' });
        expect(graph.assets).not.toContainEqual({ logicalName: 'theme.js', fileName: 'theme.a1.js' });
    });

    it('keeps the js of entries not built purely from stylesheets', () => {
        const graph = statsToGraph(stats, entryConfig);
        expect(graph.entryPoints.mixed.js).toEqual(['mixed.c3.js']);
        expect(graph.entryPoints.empty.js).toEqual(['empty.e5.js']);
    });

    it('keeps every js when no entry config is available', () => {
        const graph = statsToGraph(stats);
        expect(graph.entryPoints.theme.js).toEqual(['theme.a1.js']);
        expect(graph.assets).toContainEqual({ logicalName: 'theme.js', fileName: 'theme.a1.js' });
    });
});
