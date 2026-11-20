import type { Rollup } from 'vite';
import type { AssetEntry, EntryFiles, NormalizedGraph } from '../types';
import { relative, resolve } from 'node:path';
import { isStylesheet, slash } from '../core/paths';

export function bundleToGraph(bundle: Rollup.OutputBundle, root: string): NormalizedGraph {
    const entryPoints: Record<string, EntryFiles> = {};
    const assets: AssetEntry[] = [];
    // Entry CSS is kept in the manifest (keyed by logical name like `app.css`); async chunk CSS isn't
    // (it loads with its chunk, never via `asset()`, and would collide across same-named chunks).
    const entryCss = new Set<string>();
    const asyncCss = new Set<string>();

    for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (chunk.isEntry) {
            // Rollup can emit the entry as a thin *facade* that just re-imports the real chunk (e.g. when the
            // entry module uses top-level await); the CSS then rides on that statically-imported chunk, not the
            // facade. Walk static imports so entry CSS is collected wherever Rollup parked it.
            const imports = staticImports(chunk, bundle);
            const css = collectEntryCss(chunk, bundle);
            for (const name of css) entryCss.add(name);
            // Vite drops a style entry's empty JS chunk from the bundle *after* this hook, so advertising it
            // would render a `<script>` for a file that was never written (and break SRI, which hashes off disk).
            const styleEntry = isStylesheet(chunk.facadeModuleId);
            entryPoints[chunk.name] = {
                js: styleEntry ? [] : [chunk.fileName],
                css,
                preload: emittedChunks(imports, bundle),
                dynamic: emittedChunks(chunk.dynamicImports, bundle),
            };
            if (!styleEntry) assets.push({ logicalName: `${chunk.name}.js`, fileName: chunk.fileName });
        } else if (chunk.viteMetadata) {
            for (const name of chunk.viteMetadata.importedCss) asyncCss.add(name);
        }
    }

    for (const file of Object.values(bundle)) {
        if (file.type !== 'asset') continue;
        // Drop async-only chunk CSS (see above); entry CSS (also referenced by an entry) is kept.
        if (asyncCss.has(file.fileName) && !entryCss.has(file.fileName)) continue;
        assets.push({ logicalName: assetLogicalName(file, root, entryCss), fileName: file.fileName });
    }

    return { entryPoints, assets };
}

// A bare `import('x.css')` yields a CSS-only proxy chunk whose JS is empty or whitespace (`''` under
// rolldown-vite, `'\n'` under Rollup/Vite 7) and is never written to disk, yet its name still shows up in
// the entry's imports/dynamicImports. Keep only names backed by a chunk that has real JS, so preload and
// SRI never reference a file that was never written.
function emittedChunks(names: readonly string[], bundle: Rollup.OutputBundle): string[] {
    return names.filter((name) => {
        const output = bundle[name];
        return output?.type === 'chunk' && output.code.trim() !== '';
    });
}

// Under Vite 8, `chunk.imports` lists direct imports only.
function staticImports(entry: Rollup.OutputChunk, bundle: Rollup.OutputBundle): string[] {
    const visited = new Set<string>();
    const walk = (chunk: Rollup.OutputChunk): void => {
        for (const imported of chunk.imports) {
            if (visited.has(imported) || imported === entry.fileName) continue;
            visited.add(imported);
            const dep = bundle[imported];
            if (dep?.type === 'chunk') walk(dep);
        }
    };
    walk(entry);
    return [...visited];
}

// Collect an entry's CSS in import order, like Vite's `getCssFilesForChunk`: imported chunks' CSS (depth-first)
// before the importing chunk's own, so the entry's CSS overrides what it imports. Static imports only —
// dynamic-import CSS loads with its chunk and stays out of the entry.
function collectEntryCss(entry: Rollup.OutputChunk, bundle: Rollup.OutputBundle): string[] {
    const css = new Set<string>();
    const visited = new Set<string>();
    const walk = (chunk: Rollup.OutputChunk): void => {
        if (visited.has(chunk.fileName)) return;
        visited.add(chunk.fileName);
        for (const imported of chunk.imports) {
            const dep = bundle[imported];
            if (dep?.type === 'chunk') walk(dep);
        }
        for (const file of chunk.viteMetadata?.importedCss ?? []) css.add(file);
    };
    walk(entry);
    return [...css];
}

function assetLogicalName(file: Rollup.OutputAsset, root: string, entryCss: Set<string>): string {
    // Imported assets key by source path relative to root (matches Rsbuild's `sourceFilename`, keeps
    // same-basename files distinct); entry CSS and path-less assets fall back to the basename.
    const original = entryCss.has(file.fileName) ? undefined : file.originalFileNames[0];
    if (original) return slash(relative(root, resolve(root, original)));
    return file.names[0] ?? file.fileName;
}

export interface DevConfig {
    root: string;
    input?: Rollup.InputOption;
    build: {
        rolldownOptions?: { input?: Rollup.InputOption };
        rollupOptions?: { input?: Rollup.InputOption };
    };
}

export function configToDevGraph(config: DevConfig): NormalizedGraph {
    const entryPoints: Record<string, EntryFiles> = {};
    // Three entry keys: rolldown-vite's `rolldownOptions`, Vite 7's `rollupOptions`, Vite 8's top-level
    // `input`. Nested first because `vite build` resolves it first, so dev names the entries the build does.
    const input = config.build.rolldownOptions?.input ?? config.build.rollupOptions?.input ?? config.input;
    const entries: Record<string, string> =
        typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, string>) : {};

    for (const [name, inputPath] of Object.entries(entries)) {
        const rel = slash(relative(config.root, resolve(config.root, inputPath)));
        const type: 'js' | 'css' = isStylesheet(inputPath) ? 'css' : 'js';
        const files: EntryFiles = { js: [], css: [], preload: [], dynamic: [] };
        files[type] = [rel];
        entryPoints[name] = files;
    }

    return { entryPoints, assets: [] };
}
