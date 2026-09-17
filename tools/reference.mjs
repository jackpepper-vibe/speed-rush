/* The art-direction reference image, resolved in one place.
 *
 * `compare.mjs` and `probe.mjs` both score against a screenshot of another
 * game held locally (see `reference/README.md`). That target gets swapped as
 * the art direction is re-aimed, and when the path lived inline in both tools
 * a swap meant editing two files and remembering to fix the MIME type in each
 * — which is exactly the kind of edit that gets made in one place and not the
 * other, leaving the probe scoring a different picture than the comparison.
 *
 * Resolution order: --reference <path>, then SPEEDRUSH_REFERENCE, then the
 * default. No globbing and no "newest file wins": the tools must score against
 * the image the operator named, not against whatever was dropped in the folder
 * last.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_REFERENCE = 'reference/target2.jpg';

/**
 * Absolute path to the reference image. Does not check existence — callers
 * report an absent reference as skipped rather than failed, and need the path
 * to say which file they were looking for.
 *
 * @param {string[]} argv command-line arguments to scan for `--reference`
 * @returns {string}
 */
export function referencePath(argv = []) {
  const flag = argv.indexOf('--reference');
  const named = flag !== -1 ? argv[flag + 1] : process.env.SPEEDRUSH_REFERENCE;
  return resolve(ROOT, named || DEFAULT_REFERENCE);
}

/**
 * The reference as a data URL, typed from its extension rather than assumed.
 * Image analysis happens inside the page, so the bytes have to cross as text.
 *
 * @param {string} path
 * @returns {string}
 */
export function toDataUrl(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

/** @param {string} path */
export function referenceExists(path) {
  return existsSync(path);
}
