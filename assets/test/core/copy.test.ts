import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedCopyEntry } from '../../src/types';
import { contentHash, enumerateCopyFiles, hashedName, resolveCopyFiles, writeDevCopyFiles } from '../../src/core/copy';

const src = join(import.meta.dirname, '../fixtures/copy-src');
const binSrc = join(import.meta.dirname, '../fixtures/copy-binary');

function entry(over: Partial<ResolvedCopyEntry> = {}): ResolvedCopyEntry {
    return { from: src, to: 'images', pattern: /.*/, includeSubdirectories: true, hash: true, ...over };
}

describe('enumerateCopyFiles', () => {
    it('recurses and builds forward-slash logical names under `to`', () => {
        const names = enumerateCopyFiles([entry()])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/icons/cat.svg', 'images/logo.svg', 'images/notes.txt']);
    });

    it('filters by pattern against the from-relative path', () => {
        const names = enumerateCopyFiles([entry({ pattern: /\.svg$/ })])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/icons/cat.svg', 'images/logo.svg']);
    });

    it('skips subdirectories when includeSubdirectories is false', () => {
        const names = enumerateCopyFiles([entry({ includeSubdirectories: false })])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/logo.svg', 'images/notes.txt']);
    });

    it('warns and skips a missing `from` instead of throwing', () => {
        expect(enumerateCopyFiles([entry({ from: join(src, 'does-not-exist') })])).toEqual([]);
    });

    it('copies at the root of outputPath when `to` is empty', () => {
        const names = enumerateCopyFiles([entry({ to: '', pattern: /\.txt$/ })])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['notes.txt']);
    });

    it('aggregates multiple entries under their own `to` prefixes', () => {
        const names = enumerateCopyFiles([
            entry({ to: 'a', pattern: /\.svg$/ }),
            { from: binSrc, to: 'b', pattern: /.*/, includeSubdirectories: true, hash: true },
        ])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['a/icons/cat.svg', 'a/logo.svg', 'b/pixel.png']);
    });
});

describe('hashedName', () => {
    it('injects the hash before the extension, preserving subdirs', () => {
        expect(hashedName('images/icons/cat.svg', 'a1b2c3d4')).toBe('images/icons/cat.a1b2c3d4.svg');
    });

    it('appends the hash when there is no extension', () => {
        expect(hashedName('images/LICENSE', 'a1b2c3d4')).toBe('images/LICENSE.a1b2c3d4');
    });
});

describe('resolveCopyFiles', () => {
    it('uses hashed physical names', () => {
        const logo = resolveCopyFiles([entry()]).find((f) => f.logicalName === 'images/logo.svg')!;
        expect(logo.physicalName).toMatch(/^images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(logo.source).toBeInstanceOf(Buffer);
    });

    it('keeps the logical path and moves the hash to versionQuery for `hash: false` entries', () => {
        const logo = resolveCopyFiles([entry({ hash: false })]).find((f) => f.logicalName === 'images/logo.svg')!;
        expect(logo.physicalName).toBe('images/logo.svg');
        expect(logo.versionQuery).toMatch(/^\?[0-9a-f]{8}$/);
    });
});

describe('writeDevCopyFiles', () => {
    const tmp = (): string => mkdtempSync(join(tmpdir(), 'reprise-copy-'));

    it.each([true, false])('writes the files verbatim and keys them unversioned (hash: %s)', (hash) => {
        const out = tmp();
        const logo = writeDevCopyFiles([entry({ hash })], out).find((f) => f.logicalName === 'images/logo.svg');
        expect(logo).toEqual({ logicalName: 'images/logo.svg', physicalName: 'images/logo.svg', versionQuery: '' });
        expect(readFileSync(join(out, 'images/logo.svg')).equals(readFileSync(join(src, 'logo.svg')))).toBe(true);
    });

    it('skips a file whose source is unchanged since the previous call', () => {
        const out = tmp();
        const written = new Map<string, string>();
        writeDevCopyFiles([entry()], out, written);
        writeFileSync(join(out, 'images/logo.svg'), 'stale');
        writeDevCopyFiles([entry()], out, written);
        expect(readFileSync(join(out, 'images/logo.svg'), 'utf8')).toBe('stale');
    });

    it('rewrites a file whose source changed since the previous call', () => {
        const from = tmp();
        const out = tmp();
        const written = new Map<string, string>();
        writeFileSync(join(from, 'logo.svg'), 'v1');
        writeDevCopyFiles([entry({ from })], out, written);
        writeFileSync(join(from, 'logo.svg'), 'version 2');
        writeDevCopyFiles([entry({ from })], out, written);
        expect(readFileSync(join(out, 'images/logo.svg'), 'utf8')).toBe('version 2');
    });
});

describe('contentHash', () => {
    it('is deterministic and 8 hex chars', () => {
        const h = contentHash(Buffer.from('hello'));
        expect(h).toMatch(/^[0-9a-f]{8}$/);
        expect(h).toBe(contentHash(Buffer.from('hello')));
    });
});
