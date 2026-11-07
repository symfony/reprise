import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { createServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';
import { createCompileWaiter, getFreePort, tmpDir } from './support';

const LAZY_GREET = "/* stimulusFetch: 'lazy' */\nexport default class {}\n";
const GREET_IS_LAZY = /"greet":\s*\(\)\s*=>/;
const WAIT = { timeout: 10_000 };

// The extra controllers dir sits outside the root, which the bundler would watch anyway.
function stimulusApp(): { dir: string; admin: string } {
    const dir = tmpDir('stim-watch');
    mkdirSync(join(dir, 'controllers'));
    writeFileSync(
        join(dir, 'app.js'),
        "import { eagerControllers, lazyControllers } from 'virtual:symfony/controllers'\n" +
            'globalThis.__controllers = { eagerControllers, lazyControllers }\n'
    );
    writeFileSync(join(dir, 'controllers.json'), '{ "controllers": {} }\n');
    writeFileSync(join(dir, 'controllers/greet_controller.js'), 'export default class {}\n');
    return { dir, admin: tmpDir('stim-watch-admin') };
}

describe('the dev server picks up Stimulus changes without a restart', () => {
    it('vite', async () => {
        const { dir, admin } = stimulusApp();
        const server = await createServer({
            root: dir,
            logLevel: 'silent',
            server: { hmr: false },
            plugins: [
                SymfonyVite({
                    outputPath: join(dir, 'public/build'),
                    publicPath: '/build/',
                    stimulus: {
                        controllersJson: join(dir, 'controllers.json'),
                        controllersDirs: { admin },
                    },
                }),
            ],
        });
        const read = (): Promise<string> =>
            server.transformRequest('virtual:symfony/controllers').then(
                (result) => result?.code ?? '',
                (error: Error) => error.message
            );

        try {
            const initial = await read();
            expect(initial).toContain('"greet"');
            expect(initial).not.toMatch(GREET_IS_LAZY);

            await expect.poll(() => Object.keys(server.watcher.getWatched()), WAIT).toContain(admin);
            writeFileSync(join(admin, 'user_controller.js'), 'export default class {}\n');
            await expect.poll(read, WAIT).toContain('"admin--user"');

            // On Linux, chokidar attaches to controllers/ asynchronously; a file written before that is never reported.
            await expect.poll(() => Object.keys(server.watcher.getWatched()), WAIT).toContain(join(dir, 'controllers'));
            writeFileSync(join(dir, 'controllers/new_controller.js'), 'export default class {}\n');
            await expect.poll(read, WAIT).toContain('"new"');

            writeFileSync(join(dir, 'controllers/greet_controller.js'), LAZY_GREET);
            await expect.poll(read, WAIT).toMatch(GREET_IS_LAZY);

            writeFileSync(join(dir, 'controllers.json'), '{ invalid');
            await expect.poll(read, WAIT).toContain('not valid JSON');
        } finally {
            await server.close();
        }
    });

    it('rsbuild', async () => {
        const { dir, admin } = stimulusApp();
        const out = join(dir, 'public/build');
        const compile = createCompileWaiter();
        const rsbuild = await createRsbuild({
            cwd: dir,
            rsbuildConfig: {
                mode: 'development',
                source: { entry: { app: join(dir, 'app.js') } },
                server: { port: await getFreePort() },
                dev: { writeToDisk: true },
                plugins: [
                    SymfonyRsbuild({
                        outputPath: out,
                        publicPath: '/build/',
                        stimulus: {
                            controllersJson: join(dir, 'controllers.json'),
                            controllersDirs: { admin },
                        },
                    }),
                    compile.plugin,
                ],
            },
        });
        const read = (): string =>
            readdirSync(out, { recursive: true })
                .map(String)
                .filter((file) => file.endsWith('.js'))
                .map((file) => readFileSync(join(out, file), 'utf8'))
                .join('\n');

        const firstCompile = compile.next();
        const server = await rsbuild.startDevServer();
        try {
            await vi.waitFor(() => firstCompile, WAIT);
            expect(read()).toContain('"greet"');
            expect(read()).not.toMatch(GREET_IS_LAZY);

            let rebuilt = compile.next();
            writeFileSync(join(admin, 'user_controller.js'), 'export default class {}\n');
            await vi.waitFor(() => rebuilt, WAIT);
            expect(read()).toContain('"admin--user"');

            rebuilt = compile.next();
            writeFileSync(join(dir, 'controllers/new_controller.js'), 'export default class {}\n');
            await vi.waitFor(() => rebuilt, WAIT);
            expect(read()).toContain('"new"');

            rebuilt = compile.next();
            writeFileSync(join(dir, 'controllers/greet_controller.js'), LAZY_GREET);
            await vi.waitFor(() => rebuilt, WAIT);
            expect(read()).toMatch(GREET_IS_LAZY);

            rebuilt = compile.next();
            writeFileSync(join(dir, 'controllers.json'), '{ invalid');
            expect((await vi.waitFor(() => rebuilt, WAIT)).join('\n')).toContain('not valid JSON');
        } finally {
            await server.server.close();
        }
    });
});
