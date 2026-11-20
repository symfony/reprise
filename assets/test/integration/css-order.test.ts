import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

// `app` imports a shared chunk (vendor CSS) *before* its own CSS, so the app CSS is meant to override the
// vendor rules. `entrypoints.json` must list the CSS in that import order, the way Vite's own HTML plugin and
// Webpack Encore do; listing the entry's own CSS first flips the cascade (symfony/reprise#184).
const fixture = join(import.meta.dirname, '../fixtures/css-order');
const input = { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') };

function expectVendorCssBeforeAppCss(out: string): void {
    const css: string[] = readJson(out, 'entrypoints.json').entryPoints.app.css;
    const contents = css.map((file) => readFileSync(join(out, file.replace(/^build\//, '')), 'utf8'));

    expect(contents).toHaveLength(2);
    expect(contents[0]).toContain('.vendor-rule');
    expect(contents[1]).toContain('.app-rule');
}

describe('entry CSS follows the import order: imported chunks first, the entry itself last', () => {
    it('vite build', async () => {
        const out = tmpDir('css-order-vite');
        await viteBuild(fixture, input, { outputPath: out, publicPath: '/build/' });

        expectVendorCssBeforeAppCss(out);
    });

    it('rsbuild build', async () => {
        const out = tmpDir('css-order-rsbuild');
        await rsbuildBuild(
            fixture,
            input,
            { outputPath: out, publicPath: '/build/' },
            { tools: { rspack: { optimization: { splitChunks: { chunks: 'all', minSize: 0 } } } } }
        );

        expectVendorCssBeforeAppCss(out);
    });
});
