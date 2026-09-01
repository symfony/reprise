import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateControllersModule } from '../../src/core/stimulus';

const root = join(import.meta.dirname, '../fixtures/stimulus');
const opts = { controllersJson: join(root, 'controllers.json'), controllersDir: join(root, 'does-not-exist') };

// Local import paths are emitted with forward slashes (a portable ESM specifier), so compare
// expected filesystem paths in the same shape — otherwise the assertions fail on Windows.
const posix = (p: string): string => p.replace(/\\/g, '/');

describe('generateControllersModule — third-party', () => {
    it('emits an eager third-party controller with a static import and autoimport', () => {
        const src = generateControllersModule(opts, root, false);
        expect(src).toContain(`import controller_0 from "@acme/ux-hello/dist/hello_controller.js"`);
        expect(src).toContain(`import "@acme/ux-hello/dist/hello.css"`);
        expect(src).toContain(`"acme--ux-hello--hello": controller_0`);
    });

    it('emits a lazy third-party controller as a dynamic import factory', () => {
        const src = generateControllersModule(opts, root, false);
        expect(src).toContain(`"acme--ux-map--map": () => import("@acme/ux-map/dist/map_controller.js")`);
    });

    it('skips disabled controllers', () => {
        const src = generateControllersModule(opts, root, false);
        expect(src).not.toContain('mini-map');
    });

    it('sets isApplicationDebug from the isDev flag', () => {
        expect(generateControllersModule(opts, root, true)).toContain('export const isApplicationDebug = true');
        expect(generateControllersModule(opts, root, false)).toContain('export const isApplicationDebug = false');
    });

    it('throws a helpful error when a declared package is not installed', () => {
        const bad = { controllersJson: join(root, 'controllers.json'), controllersDir: opts.controllersDir };
        expect(() => generateControllersModule(bad, '/nonexistent-root', false)).toThrow(/npm install|could not/i);
    });
});

describe('generateControllersModule — controllers.json errors', () => {
    it('throws a clear error when the controllers.json file is missing', () => {
        const missing = {
            controllersJson: join(root, 'no-such-controllers.json'),
            controllersDir: opts.controllersDir,
        };
        expect(() => generateControllersModule(missing, root, false)).toThrow(
            /@symfony\/reprise: cannot read the Stimulus controllers file/
        );
    });

    it('throws a clear error when the controllers.json file is not valid JSON', () => {
        const malformed = {
            controllersJson: join(root, 'malformed-controllers.json'),
            controllersDir: opts.controllersDir,
        };
        expect(() => generateControllersModule(malformed, root, false)).toThrow(/is not valid JSON/);
    });
});

describe('generateControllersModule — local', () => {
    const localOpts = { controllersJson: join(root, 'controllers.json'), controllersDir: join(root, 'controllers') };

    it('emits an eager local controller by absolute path', () => {
        const src = generateControllersModule(localOpts, root, false);
        expect(src).toContain(posix(join(root, 'controllers/greet_controller.js')));
        expect(src).toMatch(/"greet": controller_\d+/);
    });

    it('emits a lazy local controller when the stimulusFetch comment is present', () => {
        const src = generateControllersModule(localOpts, root, false);
        expect(src).toContain(`"heavy": () => import(`);
        expect(src).toContain(posix(join(root, 'controllers/heavy_controller.js')));
    });

    it('detects the lazy marker in a single-line comment too', () => {
        const src = generateControllersModule(localOpts, root, false);
        expect(src).toContain(`"single-line": () => import(`);
        expect(src).toContain(posix(join(root, 'controllers/single_line_controller.js')));
    });

    it('detects the lazy marker inside a preserved /*! ... */ comment', () => {
        const src = generateControllersModule(localOpts, root, false);
        // tsc/esbuild keep `/*! ... */` comments through minification, so the marker survives.
        expect(src).toContain(`"preserved-comment": () => import(`);
        expect(src).toContain(posix(join(root, 'controllers/preserved_comment_controller.js')));
    });

    it('detects the lazy marker wherever it sits in the file, not only above the class', () => {
        const src = generateControllersModule(localOpts, root, false);
        expect(src).toContain(`"above-imports": () => import(`);
        expect(src).toContain(posix(join(root, 'controllers/above_imports_controller.js')));
    });

    it('detects the lazy marker on a dummy controller that exports something other than a class', () => {
        const src = generateControllersModule(localOpts, root, false);
        expect(src).toContain(`"dummy": () => import(`);
        expect(src).toContain(posix(join(root, 'controllers/dummy_controller.js')));
    });

    it('maps nested controllers with a double-dash identifier', () => {
        const src = generateControllersModule(localOpts, root, false);
        expect(src).toMatch(/"admin--user": controller_\d+/);
    });

    it('returns valid empty maps when there are no controllers at all', () => {
        const empty = { controllersJson: join(root, 'empty-controllers.json'), controllersDir: join(root, 'nope') };
        const src = generateControllersModule(empty, root, false);
        expect(src).toContain('export const eagerControllers = {}');
        expect(src).toContain('export const lazyControllers = {}');
    });

    it('emits controllers in a stable, name-sorted order (deterministic output/hash)', () => {
        // Local controllers are sorted by filename so the generated module -- and thus its
        // content hash -- stays stable regardless of the order the filesystem returns the files
        // in (symfony/ux#3703). Assert the exact identifier order the module is rendered in.
        const src = generateControllersModule(localOpts, root, false);
        const identifiers = [...src.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
        expect(identifiers).toEqual([
            // eagerControllers: third-party first, then local controllers sorted by filename
            'acme--ux-hello--hello',
            'admin--user',
            'greet',
            // lazyControllers: third-party first, then local controllers sorted by filename
            'acme--ux-map--map',
            'above-imports',
            'dummy',
            'heavy',
            'preserved-comment',
            'single-line',
        ]);
    });
});

describe('generateControllersModule — identifier collision', () => {
    // A local controller whose filename yields the same identifier as a third-party one
    // (contrived — local ids are short, third-party ids are long/scoped — but possible).
    const collisionOpts = {
        controllersJson: join(root, 'collision-controllers.json'),
        controllersDir: join(root, 'collision'),
    };

    it('lets a local controller override a colliding third-party identifier (local wins, emitted once)', () => {
        const src = generateControllersModule(collisionOpts, root, false);
        // The local controller is lazy; the third-party "hello" is eager. Local wins:
        expect(src).toContain(`"acme--ux-hello--hello": () => import(`);
        expect(src).toContain(posix(join(root, 'collision/acme--ux-hello--hello_controller.js')));
        // The overridden third-party import is gone (no orphaned import, no double registration):
        expect(src).not.toContain('@acme/ux-hello/dist/hello_controller.js');
        // The identifier appears exactly once across both maps:
        expect(src.split(`"acme--ux-hello--hello"`).length - 1).toBe(1);
    });
});
