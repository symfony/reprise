import type {
    BuildContext,
    DevServer,
    EntrypointsJson,
    ManifestJson,
    NormalizedGraph,
    ResolvedOptions,
} from '../types';
import type { CopyResult } from './copy';
import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEntrypoints, buildManifest } from './format';
import { integrityFromDisk, referencedFileNames } from './integrity';
import { resolvePublicPath } from './options';
import { escapeRegExp, slash, trimTrailingSlash } from './paths';

const ENTRYPOINTS_FILE = 'entrypoints.json';
const MANIFEST_FILE = 'manifest.json';

// RepriseBundle can read these files mid-rebuild, so it must never see a truncated one.
function writeFileAtomic(path: string, content: string): void {
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, content);
    try {
        renameSync(tmp, path);
    } catch {
        // Windows refuses to rename over a file another process holds open.
        rmSync(tmp, { force: true });
        writeFileSync(path, content);
    }
}

export function writeSymfonyFiles(metadataPath: string, entrypoints: EntrypointsJson, manifest: ManifestJson): void {
    mkdirSync(metadataPath, { recursive: true });
    writeFileAtomic(join(metadataPath, ENTRYPOINTS_FILE), `${JSON.stringify(entrypoints, null, 2)}\n`);
    writeFileAtomic(join(metadataPath, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

export interface WatchIgnoreRule {
    pattern: RegExp;
    globs: string[];
}

export function watchIgnore({
    outputPath,
    metadataPath,
}: Pick<ResolvedOptions, 'outputPath' | 'metadataPath'>): WatchIgnoreRule {
    const outputDir = trimTrailingSlash(slash(outputPath));
    const dir = trimTrailingSlash(slash(metadataPath));
    const files = [ENTRYPOINTS_FILE, MANIFEST_FILE].map((name) => `${dir}/${name}`);
    // The metadata files are written through a temporary sibling that changes their directory too.
    const alternatives = [
        `${escapeRegExp(outputDir)}(?:/.*)?`,
        escapeRegExp(dir),
        ...files.map((file) => `${escapeRegExp(file)}(?:\\.[^/]+\\.tmp)?`),
    ];
    return {
        pattern: new RegExp(`^(?:${alternatives.join('|')})$`),
        globs: [outputDir, `${outputDir}/**`, ...files, ...files.map((file) => `${file}.*.tmp`)],
    };
}

export interface MetadataInput {
    isProd: boolean;
    devServer: DevServer | null;
    /** Keyed in the manifest only: the adapter writes or emits the files themselves. */
    copyFiles: Omit<CopyResult, 'source'>[];
}

/** Call once the build output is on disk: SRI hashes are read from there. */
export function writeMetadata(
    options: ResolvedOptions,
    graph: NormalizedGraph,
    { isProd, devServer, copyFiles }: MetadataInput
): void {
    const ctx: BuildContext = {
        isProd,
        devServer,
        publicPath: options.publicPath,
        urlPrefix: resolvePublicPath(options.publicPath, devServer?.origin ?? null),
        manifestKeyPrefix: options.manifestKeyPrefix,
    };
    const integrity =
        isProd && options.integrity
            ? integrityFromDisk(
                  referencedFileNames(graph.entryPoints),
                  options.outputPath,
                  options.integrity.algorithms
              )
            : undefined;
    const assets = [
        // In dev the bundler's assets live in the dev server's memory: only the copied files are on disk.
        ...(isProd ? graph.assets : []),
        // Last, to win over Rsbuild's entry for the same file, which lacks the `hash: false` version query.
        ...copyFiles.map((file) => ({
            logicalName: file.logicalName,
            fileName: file.physicalName + file.versionQuery,
        })),
    ];
    writeSymfonyFiles(
        options.metadataPath,
        buildEntrypoints(integrity ? { ...graph, integrity } : graph, ctx),
        buildManifest(assets, ctx)
    );
}
