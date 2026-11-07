import type { RsbuildPlugin } from '@rsbuild/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { describe, expect, it } from 'vitest';
import Symfony from '../../src/rsbuild';
import { rsbuildBuild, tmpDir } from './support';

const fixture = join(import.meta.dirname, '../fixtures/stimulus-app');

describe('rsbuild build resolves virtual:symfony/controllers', () => {
    it('bundles local controllers via VirtualModulesPlugin', async () => {
        const out = tmpDir('rstim');
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [
                    Symfony({ outputPath: out, publicPath: '/build/', stimulus: join(fixture, 'controllers.json') }),
                ],
            },
        });
        await rsbuild.build();
        const files = readdirSync(out, { recursive: true }).map(String);
        const code = files
            .filter((f) => f.endsWith('.js'))
            .map((f) => readFileSync(join(out, f), 'utf8'))
            .join('\n');
        expect(code).toContain('greet');
        expect(code).toContain('heavy');
    });

    it('registers the controllers of a controllersDirs entry under its prefix', async () => {
        const out = tmpDir('rstim-dirs');
        await rsbuildBuild(
            fixture,
            { app: join(fixture, 'app.js') },
            {
                outputPath: out,
                publicPath: '/build/',
                stimulus: {
                    controllersJson: join(fixture, 'controllers.json'),
                    controllersDirs: { admin: join(fixture, 'admin') },
                },
            }
        );
        const code = readdirSync(out, { recursive: true })
            .map(String)
            .filter((f) => f.endsWith('.js'))
            .map((f) => readFileSync(join(out, f), 'utf8'))
            .join('\n');
        expect(code).toContain('admin--user');
        expect(code).toContain('greet');
    });

    it('fails with a clear message when the virtual module is imported but stimulus is off', async () => {
        const out = tmpDir('rstim-off');

        // Rspack wraps the plugin's throw as a generic "Rspack build failed." rejection, but records the
        // real module error on `stats.compilation.errors`. Tap `done` to read it and assert our guidance
        // is what the user sees.
        const errors: string[] = [];
        const capture: RsbuildPlugin = {
            name: 'capture-errors',
            setup(api) {
                api.onAfterCreateCompiler(({ compiler }) => {
                    const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                    for (const c of compilers) {
                        c.hooks.done.tap('capture', (stats) => {
                            for (const e of stats.compilation.errors)
                                errors.push(String((e as { message?: string }).message ?? e));
                        });
                    }
                });
            },
        };
        const rsbuildOff = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [Symfony({ outputPath: out, publicPath: '/build/' }), capture],
            },
        });

        let failed = false;
        try {
            await rsbuildOff.build();
        } catch {
            failed = true;
        }

        expect(failed).toBe(true);
        expect(errors.join('\n')).toMatch(/Stimulus integration is not enabled/);
    });
});
