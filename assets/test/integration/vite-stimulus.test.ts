import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmpDir, viteBuild } from './support';

const fixture = join(import.meta.dirname, '../fixtures/stimulus-app');
const input = { app: join(fixture, 'app.js') };

describe('vite build resolves virtual:symfony/controllers', () => {
    it('bundles local controllers, eager inlined and lazy code-split', async () => {
        const out = tmpDir('stim');
        // stimulus paths are resolved against process.cwd() (the repo root under vitest),
        // so pass an absolute controllers.json path.
        await viteBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            stimulus: join(fixture, 'controllers.json'),
        });
        const files = readdirSync(out, { recursive: true }).map(String);
        const appJs = files.find((f) => f.startsWith('app') && f.endsWith('.js'))!;
        const code = readFileSync(join(out, appJs), 'utf8');
        // eager identifier + lazy identifier both present in the entry
        expect(code).toContain('greet');
        expect(code).toContain('heavy');
        // the lazy controller is code-split into its own chunk
        expect(files.some((f) => f.endsWith('.js') && f !== appJs)).toBe(true);
    });

    it('registers the controllers of a controllersDirs entry under its prefix', async () => {
        const out = tmpDir('stim-dirs');
        await viteBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            stimulus: {
                controllersJson: join(fixture, 'controllers.json'),
                controllersDirs: { admin: join(fixture, 'admin') },
            },
        });
        const code = readdirSync(out, { recursive: true })
            .map(String)
            .filter((f) => f.endsWith('.js'))
            .map((f) => readFileSync(join(out, f), 'utf8'))
            .join('\n');
        expect(code).toContain('admin--user');
        expect(code).toContain('greet');
    });

    it('fails with a clear message when the virtual module is imported but stimulus is off', async () => {
        const out = tmpDir('stim-off');
        await expect(
            // no `stimulus` option, yet app.js imports virtual:symfony/controllers
            viteBuild(fixture, input, { outputPath: out, publicPath: '/build/' })
        ).rejects.toThrow(/Stimulus integration is not enabled/);
    });
});
