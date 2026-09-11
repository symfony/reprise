import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

// The other side of `style-entry.test.ts`: a CSS Module imported *from* a JS entry, which is how CSS Modules
// are meant to be used. The entry keeps its script (it carries the class-name mapping) and the extracted CSS
// joins its `css` bucket, exactly like a plain stylesheet import.
const fixture = join(import.meta.dirname, '../fixtures/css-modules');
const input = { app: join(fixture, 'app.js') };

interface Entrypoints {
    entryPoints: Record<string, { js: string[]; css: string[] }>;
}

function readEmitted(out: string, url: string): string {
    return readFileSync(join(out, url.replace(/^build\//, '')), 'utf8');
}

function expectScopedBadge(out: string, entrypoints: Entrypoints): void {
    const css = readEmitted(out, entrypoints.entryPoints.app.css[0]);
    // Both bundlers rewrite `.badge` to a generated name; only the mangling proves CSS Modules ran at all.
    expect(css).not.toMatch(/\.badge[\s,{]/);
    expect(css).toMatch(/#639|rebeccapurple/);

    const generated = css.match(/\.([\w-]+)\s*\{/)?.[1];
    expect(generated).toBeTruthy();
    // The mapping is what makes the entry script worth loading, so the same name must reach the JS.
    expect(readEmitted(out, entrypoints.entryPoints.app.js[0])).toContain(generated);
}

describe('CSS Modules imported from a JS entry (Vite/Rsbuild parity)', () => {
    it('vite keeps the entry js and lists the scoped css', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-cssmod-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/' })],
        });

        const entrypoints: Entrypoints = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entrypoints.entryPoints.app.js).toHaveLength(1);
        expect(entrypoints.entryPoints.app.css).toHaveLength(1);
        expectScopedBadge(out, entrypoints);

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/app.js']).toMatch(/\.js$/);
        expect(manifest['build/app.css']).toMatch(/\.css$/);
    }, 30_000);

    it('rsbuild keeps the entry js and lists the scoped css', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-cssmod-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: input },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/' })],
            },
        });
        await rsbuild.build();

        const entrypoints: Entrypoints = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entrypoints.entryPoints.app.js).toHaveLength(1);
        expect(entrypoints.entryPoints.app.css).toHaveLength(1);
        expectScopedBadge(out, entrypoints);

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/app.js']).toMatch(/\.js$/);
        expect(manifest['build/app.css']).toMatch(/\.css$/);
    }, 60_000);
});
