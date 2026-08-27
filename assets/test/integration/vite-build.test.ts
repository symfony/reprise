import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import Symfony from '../../src/vite';
import { hasTopLevelInput } from '../vite-version';

const fixture = join(import.meta.dirname, '../fixtures/basic');

async function runBuild(): Promise<string> {
    const out = mkdtempSync(join(tmpdir(), 'ups-'));
    await build({
        root: fixture,
        logLevel: 'silent',
        build: {
            emptyOutDir: true,
            rollupOptions: {
                input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
            },
        },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
    });
    return out;
}

describe('vite build emits Symfony files', () => {
    it('writes a valid entrypoints.json', async () => {
        const out = await runBuild();
        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));

        expect(entry.isProd).toBe(true);
        expect(entry.devServer).toBeNull();
        expect(entry.publicPath).toBe('/build/');
        expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app']);
        expect(entry.entryPoints.app.js).toHaveLength(1);
        expect(entry.entryPoints.app.js[0]).toMatch(/^build\/app-.*\.js$/);
        expect(entry.entryPoints.app.css[0]).toMatch(/^build\/.*\.css$/);
        expect(entry.entryPoints.app.dynamic[0]).toMatch(/^build\/.*\.js$/);
    }, 30_000);

    it('writes a flat manifest.json with logical keys and public URLs', async () => {
        const out = await runBuild();
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));

        expect(manifest['build/app.js']).toMatch(/^\/build\/app-.*\.js$/);
        expect(manifest['build/admin.js']).toMatch(/^\/build\/admin-.*\.js$/);
        for (const value of Object.values(manifest)) {
            expect(value).toMatch(/^\/build\//);
        }
    }, 30_000);

    it('sets Vite base to publicPath so emitted CSS references assets under /build/', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: {
                emptyOutDir: true,
                assetsInlineLimit: 0, // force logo.svg to a file so the CSS keeps a url()
                rollupOptions: {
                    input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
                },
            },
            plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
        });

        const cssFile = readdirSync(out).find((f) => f.endsWith('.css'))!;
        const css = readFileSync(join(out, cssFile), 'utf8');
        expect(css).toContain('/build/');
        expect(css).not.toMatch(/url\(\/logo/); // must NOT reference /logo… at the root
    }, 30_000);
});

describe('vite top-level input', () => {
    it.skipIf(!hasTopLevelInput)(
        'emits Symfony files from the top-level input',
        async () => {
            const out = mkdtempSync(join(tmpdir(), 'ups-top-level-input-'));
            await build({
                root: fixture,
                logLevel: 'silent',
                input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
                build: { emptyOutDir: true },
                plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
            });

            const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
            expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app']);
            expect(entry.entryPoints.app.js[0]).toMatch(/^build\/app-.*\.js$/);

            const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
            expect(manifest['build/app.js']).toMatch(/^\/build\/app-.*\.js$/);
        },
        30_000
    );
});
