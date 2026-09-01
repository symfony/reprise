import type { ResolvedStimulusOptions } from '../types';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { slash } from './paths';

interface UserControllerConfig {
    enabled?: boolean;
    fetch?: 'eager' | 'lazy';
    name?: string;
    autoimport?: Record<string, boolean>;
}
interface PackageControllerConfig {
    main: string;
    name?: string;
    fetch?: 'eager' | 'lazy';
    autoimport?: Record<string, boolean>;
}
interface ControllersJson {
    controllers?: Record<string, Record<string, UserControllerConfig>>;
}

/** The virtual module the runtime helper imports; provided by each bundler adapter. */
export const VIRTUAL_CONTROLLERS_ID = 'virtual:symfony/controllers';

/** Shown when the virtual module is imported while the `stimulus` option is unset. */
export const STIMULUS_NOT_ENABLED_MESSAGE =
    `[@symfony/reprise] "${VIRTUAL_CONTROLLERS_ID}" was imported (this is what startStimulusApp() ` +
    `from "@symfony/reprise/stimulus" pulls in), but the Stimulus integration is not enabled. ` +
    `Add \`stimulus: './assets/controllers.json'\` (or your own controllers.json path) to the ` +
    `@symfony/reprise plugin options.`;

interface ResolvedController {
    identifier: string;
    fetch: 'eager' | 'lazy';
    /** Import specifier: a bare package path (third-party) or an absolute file path (local). */
    main: string;
    /** Extra modules to import alongside the controller (third-party only). */
    autoimports: string[];
}

// A controller opts into lazy loading with a `stimulusFetch: 'lazy'` comment anywhere in the file
// (line/block comment, either quotes, `/*!...*/` survives minification), like @symfony/stimulus-bridge.
// The marker is not tied to a class: a dummy controller exporting a plain value opts in the same way.
const LAZY_COMMENT_RE = /\/\*!?\s*stimulusFetch:\s*['"]lazy['"]\s*\*\/|\/\/\s*stimulusFetch:\s*['"]lazy['"]/i;
const LOCAL_CONTROLLER_RE = /[-_]controller\.[jt]s$/;

// Every other failure in this module reports a `@symfony/reprise:` error; a missing or malformed
// controllers.json must not slip through as a raw Node ENOENT/SyntaxError.
function readControllersJson(controllersJson: string): ControllersJson {
    let raw: string;
    try {
        raw = readFileSync(controllersJson, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                `@symfony/reprise: cannot read the Stimulus controllers file "${controllersJson}". ` +
                    'Create it, or point the "stimulus" option at the right path.'
            );
        }
        throw err;
    }
    try {
        return JSON.parse(raw) as ControllersJson;
    } catch (err) {
        throw new Error(
            `@symfony/reprise: the Stimulus controllers file "${controllersJson}" is not valid JSON` +
                `${err instanceof Error ? ` (${err.message})` : ''}.`
        );
    }
}

export function generateControllersModule(opts: ResolvedStimulusOptions, root: string, isDev: boolean): string {
    // Keyed by identifier; local added after third-party so a local override wins (last write wins).
    const controllers = new Map<string, ResolvedController>();

    const require = createRequire(path.join(root, 'noop.js'));
    const json = readControllersJson(opts.controllersJson);

    for (const packageName of Object.keys(json.controllers ?? {})) {
        let pkg: { symfony?: { controllers?: Record<string, PackageControllerConfig> } };
        try {
            pkg = require(`${packageName}/package.json`);
        } catch {
            throw new Error(
                `@symfony/reprise: cannot find "${packageName}/package.json". Install the package (e.g. "npm install ${packageName}").`
            );
        }
        const pkgControllers = pkg.symfony?.controllers ?? {};

        for (const controllerName of Object.keys(json.controllers![packageName])) {
            const user = json.controllers![packageName][controllerName];
            if (user.enabled === false) continue;
            const pkgCfg = pkgControllers[controllerName];
            if (!pkgCfg)
                throw new Error(
                    `@symfony/reprise: controller "${packageName}/${controllerName}" is not declared in ${packageName}'s package.json "symfony.controllers".`
                );

            const identifier = thirdPartyIdentifier(packageName, controllerName, pkgCfg.name, user.name);
            controllers.set(identifier, {
                identifier,
                fetch: user.fetch ?? pkgCfg.fetch ?? 'eager',
                main: `${packageName}/${pkgCfg.main}`,
                autoimports: Object.entries(user.autoimport ?? pkgCfg.autoimport ?? {})
                    .filter(([, v]) => v)
                    .map(([k]) => k),
            });
        }
    }

    for (const rel of listLocalControllers(opts.controllersDir)) {
        const abs = path.join(opts.controllersDir, rel);
        const identifier = localIdentifier(rel);
        controllers.set(identifier, {
            identifier,
            fetch: LAZY_COMMENT_RE.test(readFileSync(abs, 'utf8')) ? 'lazy' : 'eager',
            // Forward slashes: a portable ESM specifier (a Windows backslash path isn't).
            main: slash(abs),
            autoimports: [],
        });
    }

    return render([...controllers.values()], isDev);
}

// Stimulus identifier normalization: `_` -> `-`, `/` -> `--` (e.g. `foo/bar_baz` -> `foo--bar-baz`).
function normalizeIdentifier(id: string): string {
    return id.replace(/_/g, '-').replace(/\//g, '--');
}

function thirdPartyIdentifier(
    packageName: string,
    controllerName: string,
    pkgName?: string,
    userName?: string
): string {
    // Explicit user/package names keep their underscores; only the slash separator is collapsed.
    if (userName) return userName.replace(/\//g, '--');
    if (pkgName) return pkgName.replace(/\//g, '--');
    let id = `${packageName}/${controllerName}`;
    if (id.startsWith('@')) id = id.slice(1);
    return normalizeIdentifier(id);
}

function render(controllers: ResolvedController[], isDev: boolean): string {
    const imports: string[] = [];
    const seenAutoimports = new Set<string>();
    const eager: string[] = [];
    const lazy: string[] = [];
    let index = 0;

    for (const c of controllers) {
        if (c.fetch === 'lazy') {
            if (c.autoimports.length) {
                const all = [c.main, ...c.autoimports].map((m) => `import(${JSON.stringify(m)})`).join(', ');
                lazy.push(`  ${JSON.stringify(c.identifier)}: () => Promise.all([${all}]).then(r => r[0]),`);
            } else {
                lazy.push(`  ${JSON.stringify(c.identifier)}: () => import(${JSON.stringify(c.main)}),`);
            }
        } else {
            const varName = `controller_${index++}`;
            imports.push(`import ${varName} from ${JSON.stringify(c.main)}`);
            for (const a of c.autoimports) {
                // Two eager controllers can declare the same autoimport; emit each import only once.
                if (!seenAutoimports.has(a)) {
                    seenAutoimports.add(a);
                    imports.push(`import ${JSON.stringify(a)}`);
                }
            }
            eager.push(`  ${JSON.stringify(c.identifier)}: ${varName},`);
        }
    }

    const lines = [...imports, ''];
    lines.push(`export const eagerControllers = {${eager.length ? `\n${eager.join('\n')}\n` : ''}}`);
    lines.push(`export const lazyControllers = {${lazy.length ? `\n${lazy.join('\n')}\n` : ''}}`);
    lines.push(`export const isApplicationDebug = ${isDev ? 'true' : 'false'}`);
    lines.push('');
    return lines.join('\n');
}

function listLocalControllers(dir: string): string[] {
    let entries: string[];
    try {
        entries = readdirSync(dir, { recursive: true }) as unknown as string[];
    } catch {
        return []; // dir absent -> no local controllers
    }
    return (
        entries
            .map((e) => slash(String(e)))
            .filter((e) => LOCAL_CONTROLLER_RE.test(e))
            // Sort so the module (and its content hash) is stable across FS order. See symfony/ux#3703.
            .sort()
    );
}

function localIdentifier(rel: string): string {
    const base = slash(rel).replace(/[-_]controller\.[jt]s$/, '');
    return normalizeIdentifier(base);
}
