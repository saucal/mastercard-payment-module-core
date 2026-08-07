/**
 * Which site this worker is testing.
 *
 * The suite runs against several identical installs so several suites can run at
 * once. Playwright already provides the queue: with `fullyParallel: false` and
 * `workers: N` it hands each worker the next spec *file* as soon as it frees up.
 * All that is missing is pinning a worker to a site, which `TEST_PARALLEL_INDEX`
 * does — it is the worker's slot number, stable in `0…workers-1` and reused by a
 * replacement worker, unlike `TEST_WORKER_INDEX` which keeps incrementing.
 *
 * Keep `workers` <= the number of sites. Two workers sharing one install would
 * fight over gateway settings, since `configureGateway()` rewrites them globally.
 */

const FALLBACK_URL = 'https://mastercard-saucal.sa.ngrok.io';

/** Strip the trailing slash so `${url}/wp-json/...` never doubles it. */
function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Every install available to the run, in worker-slot order.
 *
 * `WP_BASE_URLS` (comma-separated) wins when set; otherwise the three
 * conventional keys are used, skipping any that are blank.
 */
export function siteUrls(): string[] {
  const explicit = (process.env.WP_BASE_URLS || '')
    .split(',')
    .map(normalize)
    .filter(Boolean);
  if (explicit.length) return explicit;

  return [process.env.WP_BASE_URL, process.env.WP_BASE_STG_URL, process.env.WP_BASE_DEV_URL]
    .map((url) => normalize(url || ''))
    .filter(Boolean);
}

/** The install this worker owns. */
export function siteUrl(): string {
  const urls = siteUrls();
  if (!urls.length) return FALLBACK_URL;
  const slot = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  return urls[slot % urls.length];
}

/** Worker slot, i.e. which entry of `siteUrls()` this process is testing. */
export function siteSlot(): number {
  const urls = siteUrls();
  const slot = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  return urls.length ? slot % urls.length : 0;
}

/**
 * Read a setting for a specific site, falling back to the unsuffixed key.
 *
 * Site 1 uses the plain name (`WP_API_PASS`); later sites may override it with a
 * 1-based suffix (`WP_API_PASS_2`, `WP_API_PASS_3`). Anything genuinely shared
 * across installs needs no suffix at all.
 *
 * Application passwords in particular are per-install — WordPress stores them
 * against the user row of that site, so one value cannot authenticate three
 * hosts. WooCommerce consumer keys may happen to be shared when the installs are
 * clones of one database, but that is luck, not a guarantee.
 */
export function siteEnv(name: string, slot: number = siteSlot()): string {
  const suffixed = slot > 0 ? process.env[`${name}_${slot + 1}`] : undefined;
  return (suffixed ?? process.env[name] ?? '').trim();
}

/**
 * Filename-safe identifier for the current site, for artifacts that must not be
 * shared between installs — saved sessions above all, since cookies are
 * host-scoped and one file cannot authenticate three hosts.
 */
export function siteKey(url: string = siteUrl()): string {
  return url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
