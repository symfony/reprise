import type { AssetEntry, EntryFiles, NormalizedGraph } from '../types';
import { extname } from 'node:path';
import { isStylesheet, stripUrlSuffix } from '../core/paths';

/** Minimal subset of the Rspack/webpack stats JSON (from `compilation.getStats().toJson(...)`). */
export interface RspackStats {
    entrypoints?: Record<string, { assets?: { name: string }[] }>;
    assetsByChunkName?: Record<string, string[]>;
    assets?: { name: string; info?: { sourceFilename?: string } }[];
}

function fileExt(name: string): string {
    return extname(stripUrlSuffix(name)).slice(1);
}

function isHotUpdate(name: string): boolean {
    return name.includes('.hot-update.');
}

/** Rspack's normalized `compiler.options.entry` (`EntryStaticNormalized`): entry name -> its source imports. */
export type RspackEntry = Record<string, { import?: string[] }>;

/**
 * Entries built purely from stylesheets (`{ theme: 'theme.scss' }`). Rspack always emits a runtime-only JS
 * file for them, where Vite prunes its equivalent; hiding it on both sides matches Encore's `addStyleEntry`,
 * which shipped CSS and no `<script>`. The file itself stays on disk, simply unreferenced.
 */
export function styleEntryNames(entry: RspackEntry | undefined): Set<string> {
    const names = new Set<string>();
    for (const [name, { import: sources = [] }] of Object.entries(entry ?? {})) {
        if (sources.length > 0 && sources.every(isStylesheet)) names.add(name);
    }
    return names;
}

export function statsToGraph(stats: RspackStats, entryConfig?: RspackEntry): NormalizedGraph {
    const styleEntries = styleEntryNames(entryConfig);
    const entryPoints: Record<string, EntryFiles> = {};
    for (const [name, entry] of Object.entries(stats.entrypoints ?? {})) {
        const files: EntryFiles = { js: [], css: [], preload: [], dynamic: [] };
        const styleEntry = styleEntries.has(name);
        for (const asset of entry.assets ?? []) {
            if (isHotUpdate(asset.name)) continue;
            const ext = fileExt(asset.name);
            if (ext === 'js' && !styleEntry) files.js.push(asset.name);
            else if (ext === 'css') files.css.push(asset.name);
        }
        entryPoints[name] = files;
    }

    const assets: AssetEntry[] = [];
    for (const [chunkName, files] of Object.entries(stats.assetsByChunkName ?? {})) {
        const styleEntry = styleEntries.has(chunkName);
        for (const fileName of files) {
            if (isHotUpdate(fileName)) continue;
            const ext = fileExt(fileName);
            if (ext === 'js' && styleEntry) continue;
            assets.push({ logicalName: `${chunkName}.${ext}`, fileName });
        }
    }
    for (const asset of stats.assets ?? []) {
        const logical = asset.info?.sourceFilename;
        if (!logical || isHotUpdate(asset.name)) continue;
        assets.push({ logicalName: stripUrlSuffix(logical), fileName: asset.name });
    }

    return { entryPoints, assets };
}
