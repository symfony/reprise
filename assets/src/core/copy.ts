import type { ResolvedCopyEntry } from '../types';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';

export interface CopyResult {
    /** Path used for the manifest key, e.g. `images/icons/cat.svg`. */
    logicalName: string;
    /** Path written under outputPath: content-hashed in build, verbatim in dev and for `hash: false` entries. */
    physicalName: string;
    /** `?<contenthash>` appended to the manifest value for `hash: false` entries in build, `''` otherwise. */
    versionQuery: string;
    source: Buffer;
}

function walk(dir: string, includeSubdirectories: boolean): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (includeSubdirectories) out.push(...walk(abs, includeSubdirectories));
        } else {
            out.push(abs);
        }
    }
    return out;
}

export function enumerateCopyFiles(
    entries: ResolvedCopyEntry[]
): Array<{ absPath: string; logicalName: string; hash: boolean }> {
    const out: Array<{ absPath: string; logicalName: string; hash: boolean }> = [];
    for (const entry of entries) {
        let files: string[];
        try {
            files = walk(entry.from, entry.includeSubdirectories);
        } catch {
            console.warn(`[@symfony/reprise] copy: source directory "${entry.from}" not found, skipping`);
            continue;
        }
        for (const absPath of files) {
            const rel = relative(entry.from, absPath).split(sep).join('/');
            if (!entry.pattern.test(rel)) continue;
            out.push({ absPath, logicalName: entry.to ? `${entry.to}/${rel}` : rel, hash: entry.hash });
        }
    }
    return out;
}

export function contentHash(source: Buffer): string {
    return createHash('sha256').update(source).digest('hex').slice(0, 8);
}

export function hashedName(logicalName: string, hash: string): string {
    const ext = extname(logicalName);
    const base = ext ? logicalName.slice(0, -ext.length) : logicalName;
    return `${base}.${hash}${ext}`;
}

export function resolveCopyFiles(entries: ResolvedCopyEntry[]): CopyResult[] {
    return enumerateCopyFiles(entries).map(({ absPath, logicalName, hash }) => {
        const source = readFileSync(absPath);
        const version = contentHash(source);
        return hash
            ? { logicalName, physicalName: hashedName(logicalName, version), versionQuery: '', source }
            : { logicalName, physicalName: logicalName, versionQuery: `?${version}`, source };
    });
}

// Rsbuild calls this on every dev rebuild: `written` lets it skip the files whose source did not change.
export function writeDevCopyFiles(
    entries: ResolvedCopyEntry[],
    outputPath: string,
    written: Map<string, string> = new Map()
): Omit<CopyResult, 'source'>[] {
    return enumerateCopyFiles(entries).map(({ absPath, logicalName }) => {
        const { mtimeMs, size } = statSync(absPath);
        const stamp = `${absPath}:${mtimeMs}:${size}`;
        if (written.get(logicalName) !== stamp) {
            const dest = join(outputPath, logicalName);
            mkdirSync(dirname(dest), { recursive: true });
            writeFileSync(dest, readFileSync(absPath));
            written.set(logicalName, stamp);
        }
        return { logicalName, physicalName: logicalName, versionQuery: '' };
    });
}
