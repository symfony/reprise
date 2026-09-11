import { extname } from 'node:path';

/** Normalize Windows backslash separators to forward slashes (portable URLs and ESM specifiers). */
export function slash(p: string): string {
    return p.replace(/\\/g, '/');
}

/** Drop a single trailing slash, e.g. when composing a dev-server origin with a public path. */
export function trimTrailingSlash(s: string): string {
    return s.replace(/\/$/, '');
}

/** Drop a `url()` query/fragment (`./x.woff2?v=1`): Rspack keeps it in `sourceFilename`, Vite doesn't. */
export function stripUrlSuffix(name: string): string {
    return name.replace(/[?#].*$/, '');
}

const STYLESHEET_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus', '.postcss', '.pcss']);

/**
 * True when the path is a stylesheet source, so an entry pointing at it is a *style entry* (Encore's
 * `addStyleEntry`): it compiles to CSS only and must not advertise a JS file.
 */
export function isStylesheet(path: string | null | undefined): boolean {
    if (!path) return false;
    return STYLESHEET_EXTS.has(extname(stripUrlSuffix(path)).toLowerCase());
}
