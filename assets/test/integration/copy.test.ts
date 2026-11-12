import type { RsbuildPlugin } from '@rsbuild/core';
import type { ViteDevServer } from 'vite';
import { appendFileSync, cpSync, existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCompileWaiter, readJson, rsbuildBuild, rsbuildDev, tmpDir, viteBuild, viteDev } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const input = { app: join(fixture, 'app.js') };
const copySrc = join(import.meta.dirname, '../fixtures/copy-src');
const copyBinary = join(import.meta.dirname, '../fixtures/copy-binary');
const copy = [{ from: copySrc, to: 'images' }];
const WAIT = { timeout: 10_000 };

// A copy of the fixture, so a rebuild can be triggered by editing its entry.
function editableFixture(): string {
    const dir = tmpDir('copy-dev-src');
    cpSync(fixture, dir, { recursive: true });
    // Backdated, or the watcher can count the copy itself as a change.
    const past = new Date(Date.now() - 60_000);
    for (const path of [join(dir, 'app.js'), dir]) utimesSync(path, past, past);
    return dir;
}

describe('vite copy', () => {
    it('build: copied files are hashed on disk and keyed in manifest.json', async () => {
        const out = tmpDir('copy-vite-build');
        await viteBuild(fixture, input, { outputPath: out, publicPath: '/build/', copy });

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(manifest['build/images/icons/cat.svg']).toMatch(/^\/build\/images\/icons\/cat\.[0-9a-f]{8}\.svg$/);

        const physical = manifest['build/images/logo.svg'].replace('/build/', '');
        expect(existsSync(join(out, physical))).toBe(true);
    });

    it('build: `hash: false` entries keep their logical path, versioned in the manifest query', async () => {
        const out = tmpDir('copy-vite-nohash');
        await viteBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            copy: [{ from: copySrc, to: 'images', hash: false }],
        });

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.svg\?[0-9a-f]{8}$/);
        expect(existsSync(join(out, 'images/logo.svg'))).toBe(true);
    });

    it('build: an empty `to` copies at the root of outputPath', async () => {
        const out = tmpDir('copy-vite-root');
        await viteBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            copy: [{ from: copySrc, to: '', hash: false }],
        });

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/logo.svg']).toMatch(/^\/build\/logo\.svg\?[0-9a-f]{8}$/);
        expect(existsSync(join(out, 'logo.svg'))).toBe(true);
    });

    it('build: no copy option leaves the manifest without image keys', async () => {
        const out = tmpDir('copy-vite-off');
        await viteBuild(fixture, input, { outputPath: out, publicPath: '/build/' });
        const manifest = readJson(out, 'manifest.json');
        expect(Object.keys(manifest).some((k) => k.startsWith('build/images/'))).toBe(false);
    });

    it('build: a `to` with a leading "./" yields clean, non-relative fileNames and manifest keys', async () => {
        // Regression: Rollup rejects an emitted asset fileName that looks relative ("./images/…"),
        // so this build threw before `to` normalization stripped the leading "./".
        const out = tmpDir('copy-vite-dotslash');
        await viteBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            copy: [{ from: copySrc, to: './images/' }],
        });
        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(Object.keys(manifest).some((k) => k.includes('/./'))).toBe(false);
    });

    it('build: preserves binary file bytes exactly', async () => {
        const out = tmpDir('copy-vite-bin');
        await viteBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            copy: [{ from: copyBinary, to: 'bin' }],
        });
        const manifest = readJson(out, 'manifest.json');
        const physical = manifest['build/bin/pixel.png'].replace('/build/', '');
        expect(readFileSync(join(out, physical)).equals(readFileSync(join(copyBinary, 'pixel.png')))).toBe(true);
    });

    it('build: emits copied files as bundle assets (shown in the output)', async () => {
        const out = tmpDir('copy-vite-emit');
        let bundleKeys: string[] = [];
        await viteBuild(
            fixture,
            input,
            { outputPath: out, publicPath: '/build/', copy },
            {
                plugins: [
                    {
                        name: 'capture-bundle',
                        generateBundle(_options, bundle) {
                            bundleKeys = Object.keys(bundle);
                        },
                    },
                ],
            }
        );
        expect(bundleKeys.some((k) => /^images\/logo\.[0-9a-f]{8}\.svg$/.test(k))).toBe(true);
    });

    describe('dev', () => {
        let server: ViteDevServer;
        let out: string;

        beforeEach(async () => {
            out = tmpDir('copy-vite-dev');
            server = await viteDev(
                fixture,
                input,
                { outputPath: out, publicPath: '/build/', copy },
                { server: { host: '127.0.0.1' } }
            );
        });

        afterEach(async () => {
            await server.close();
        });

        it('copies files verbatim on disk and keys them with relative URLs in manifest.json', () => {
            const manifest = readJson(out, 'manifest.json');
            expect(manifest['build/images/logo.svg']).toBe('/build/images/logo.svg');
            expect(manifest['build/images/icons/cat.svg']).toBe('/build/images/icons/cat.svg');
            expect(existsSync(join(out, 'images/logo.svg'))).toBe(true);
        });
    });

    it('dev: a rebuild leaves unchanged copied files alone', async () => {
        const dir = editableFixture();
        const out = tmpDir('copy-vite-dev-rebuild');
        const server = await viteDev(
            dir,
            { app: join(dir, 'app.js') },
            { outputPath: out, publicPath: '/build/', copy },
            { server: { host: '127.0.0.1' } }
        );
        try {
            writeFileSync(join(out, 'images/logo.svg'), 'stale');
            let changed = false;
            server.watcher.on('change', () => (changed = true));
            // Written again on each poll: the watcher can miss a change made before it is fully attached.
            await expect
                .poll(() => {
                    appendFileSync(join(dir, 'app.js'), 'console.log(2);\n');
                    return changed;
                }, WAIT)
                .toBe(true);
            expect(readFileSync(join(out, 'images/logo.svg'), 'utf8')).toBe('stale');
        } finally {
            await server.close();
        }
    });
});

describe('rsbuild copy', () => {
    it('build: copied files are hashed on disk and keyed in manifest.json', async () => {
        const out = tmpDir('copy-rsbuild-build');
        await rsbuildBuild(fixture, input, { outputPath: out, publicPath: '/build/', copy });

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(manifest['build/images/icons/cat.svg']).toMatch(/^\/build\/images\/icons\/cat\.[0-9a-f]{8}\.svg$/);

        const physical = manifest['build/images/logo.svg'].replace('/build/', '');
        expect(existsSync(join(out, physical))).toBe(true);
    });

    it('build: `hash: false` entries keep their logical path, versioned in the manifest query', async () => {
        const out = tmpDir('copy-rsbuild-nohash');
        await rsbuildBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            copy: [{ from: copySrc, to: 'images', hash: false }],
        });

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.svg\?[0-9a-f]{8}$/);
        expect(existsSync(join(out, 'images/logo.svg'))).toBe(true);
    });

    it('build: an empty `to` copies at the root of outputPath', async () => {
        const out = tmpDir('copy-rsbuild-root');
        await rsbuildBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            copy: [{ from: copySrc, to: '', hash: false }],
        });

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/logo.svg']).toMatch(/^\/build\/logo\.svg\?[0-9a-f]{8}$/);
        expect(existsSync(join(out, 'logo.svg'))).toBe(true);
    });

    it('build: no copy option leaves the manifest without image keys', async () => {
        const out = tmpDir('copy-rsbuild-off');
        await rsbuildBuild(fixture, input, { outputPath: out, publicPath: '/build/' });
        const manifest = readJson(out, 'manifest.json');
        expect(Object.keys(manifest).some((k) => k.startsWith('build/images/'))).toBe(false);
    });

    it('build: a `to` with a leading "./" yields clean manifest keys (no "build/./…")', async () => {
        // Regression: without `to` normalization the keys came out as "build/./images/…".
        const out = tmpDir('copy-rsbuild-dotslash');
        await rsbuildBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            copy: [{ from: copySrc, to: './images/' }],
        });
        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(Object.keys(manifest).some((k) => k.includes('/./'))).toBe(false);
    });

    it('build: preserves binary file bytes exactly', async () => {
        const out = tmpDir('copy-rsbuild-bin');
        await rsbuildBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            copy: [{ from: copyBinary, to: 'bin' }],
        });
        const manifest = readJson(out, 'manifest.json');
        const physical = manifest['build/bin/pixel.png'].replace('/build/', '');
        expect(readFileSync(join(out, physical)).equals(readFileSync(join(copyBinary, 'pixel.png')))).toBe(true);
    });

    it('build: emits copied files as Rspack compilation assets (shown in the output)', async () => {
        const out = tmpDir('copy-rsbuild-emit');
        let assetNames: string[] = [];
        const captureAssets: RsbuildPlugin = {
            name: 'capture-assets',
            setup(api) {
                api.onAfterCreateCompiler(({ compiler }) => {
                    const cs = 'compilers' in compiler ? compiler.compilers : [compiler];
                    for (const c of cs) {
                        c.hooks.done.tap('capture-assets', (stats) => {
                            assetNames = ((stats.toJson({ assets: true }).assets ?? []) as { name: string }[]).map(
                                (a) => a.name
                            );
                        });
                    }
                });
            },
        };
        await rsbuildBuild(
            fixture,
            input,
            { outputPath: out, publicPath: '/build/', copy },
            { plugins: [captureAssets] }
        );
        expect(assetNames.some((n) => /^images\/logo\.[0-9a-f]{8}\.svg$/.test(n))).toBe(true);
    });

    it('dev: copies files verbatim on disk and keys them with relative URLs in manifest.json', async () => {
        const out = tmpDir('copy-rsbuild-dev');
        const server = await rsbuildDev(fixture, input, { outputPath: out, publicPath: '/build/', copy });
        try {
            const manifest = readJson(out, 'manifest.json');
            expect(manifest['build/images/logo.svg']).toBe('/build/images/logo.svg');
            expect(manifest['build/images/icons/cat.svg']).toBe('/build/images/icons/cat.svg');
            expect(existsSync(join(out, 'images/logo.svg'))).toBe(true);
        } finally {
            await server.server.close();
        }
    });

    it('dev: a rebuild leaves unchanged copied files alone', async () => {
        const dir = editableFixture();
        const out = tmpDir('copy-rsbuild-dev-rebuild');
        const compile = createCompileWaiter();
        const server = await rsbuildDev(
            dir,
            { app: join(dir, 'app.js') },
            { outputPath: out, publicPath: '/build/', copy },
            { plugins: [compile.plugin] }
        );
        try {
            writeFileSync(join(out, 'images/logo.svg'), 'stale');
            const rebuilt = compile.next();
            appendFileSync(join(dir, 'app.js'), 'console.log(2);\n');
            expect(await rebuilt).toEqual([]);
            expect(readFileSync(join(out, 'images/logo.svg'), 'utf8')).toBe('stale');
        } finally {
            await server.server.close();
        }
    });
});
