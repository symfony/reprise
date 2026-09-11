import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { referencedFileNames } from '../../src/core/integrity';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

// A *style entry* — an entry pointing straight at a stylesheet (`{ theme: 'theme.scss' }`), Encore's
// `addStyleEntry` — compiles to CSS and nothing else. Vite drops the empty JS chunk it produces, so any
// reference to it is a 404 (and SRI, which hashes entry files off disk, throws ENOENT); Rspack emits a
// runtime-only JS file, which the plugin deletes from the build. Both must advertise CSS only. `.css` here
// because sass isn't a test dependency; the rule is the file extension, so `.scss` follows the same path.
const fixture = join(import.meta.dirname, '../fixtures/style-entry');
const input = { app: join(fixture, 'app.js'), theme: join(fixture, 'theme.css') };

function jsFilesOnDisk(dir: string): string[] {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => entry.name);
}

describe('style entries advertise CSS only (Vite/Rsbuild parity)', () => {
    it('vite emits no js for the style entry, and SRI survives', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-style-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/', integrity: { enabled: true } })],
        });

        const entrypoints = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entrypoints.entryPoints.theme.js).toEqual([]);
        expect(entrypoints.entryPoints.theme.css).toHaveLength(1);

        // Every file we advertise must exist on disk — the regression this pins.
        for (const ref of referencedFileNames(entrypoints.entryPoints)) {
            expect(existsSync(join(out, ref.replace(/^build\//, '')))).toBe(true);
            expect(entrypoints.integrity[ref]).toMatch(/^sha384-/);
        }

        // Vite never wrote the style entry's chunk, so the app entry's is the only JS in the build.
        expect(jsFilesOnDisk(out)).toHaveLength(1);

        // The normal entry is untouched.
        expect(entrypoints.entryPoints.app.js).toHaveLength(1);

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/theme.css']).toMatch(/\.css$/);
        expect(manifest['build/theme.js']).toBeUndefined();
        expect(manifest['build/app.js']).toMatch(/\.js$/);
    }, 30_000);

    it('rsbuild deletes the runtime-only js of the style entry', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-style-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: input },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/' })],
            },
        });
        await rsbuild.build();

        const entrypoints = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entrypoints.entryPoints.theme.js).toEqual([]);
        expect(entrypoints.entryPoints.theme.css).toHaveLength(1);
        expect(entrypoints.entryPoints.app.js).toHaveLength(1);

        // Deleted from the compilation, so the app entry's is the only JS in the build.
        expect(jsFilesOnDisk(out)).toHaveLength(1);

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/theme.css']).toMatch(/\.css$/);
        expect(manifest['build/theme.js']).toBeUndefined();
        expect(manifest['build/app.js']).toMatch(/\.js$/);
    }, 60_000);
});
