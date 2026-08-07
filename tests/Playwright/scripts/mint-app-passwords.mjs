#!/usr/bin/env node
/**
 * Create a WordPress application password named `pw-e2e` on every configured
 * install and print the `.env` lines to paste.
 *
 * Application passwords are per-install: WordPress stores them against that
 * site's user row, so one value cannot authenticate three hosts. The suites need
 * one per site because `custom/v1/*` (the log/mail/settings endpoints) runs
 * `wp_authenticate()` in its permission callback — WooCommerce consumer keys do
 * not satisfy that, only a real WP credential does.
 *
 * Idempotent-ish: it always creates a NEW password named `pw-e2e`, so running it
 * repeatedly leaves several entries. Revoke old ones under
 * Users → Profile → Application Passwords.
 *
 * Usage (from tests/Playwright):
 *   node scripts/mint-app-passwords.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env reader — this script runs outside Playwright, so no dotenv.
function readEnv() {
  const file = path.join(HERE, '..', '.env');
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = readEnv();
const sites = [
  env.WP_BASE_URL,
  env.WP_BASE_STG_URL,
  env.WP_BASE_DEV_URL,
].map((u) => (u || '').trim().replace(/\/+$/, '')).filter(Boolean);

if (!sites.length) {
  console.error('No sites in .env (WP_BASE_URL / WP_BASE_STG_URL / WP_BASE_DEV_URL)');
  process.exit(1);
}

/** Log in with a real password and keep the cookies. */
async function login(site, username, password) {
  const body = new URLSearchParams({
    log: username, pwd: password, 'wp-submit': 'Log In',
    redirect_to: `${site}/wp-admin/`, testcookie: '1',
  });
  const res = await fetch(`${site}/wp-login.php`, {
    method: 'POST', body, redirect: 'manual',
  });
  const cookies = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0]).join('; ');
  if (!cookies.includes('wordpress_logged_in')) {
    throw new Error(`login failed (HTTP ${res.status}) — check WP_USERNAME / WP_PASSWORD`);
  }
  return cookies;
}

/** The REST nonce lives in the admin page's inline wp-api-fetch config. */
async function restNonce(site, cookies) {
  const res = await fetch(`${site}/wp-admin/profile.php`, { headers: { cookie: cookies } });
  const html = await res.text();
  const m = html.match(/rest_nonce":"([a-f0-9]+)"/);
  if (!m) throw new Error('could not read REST nonce from profile.php');
  return m[1];
}

async function createPassword(site, cookies, nonce) {
  const res = await fetch(`${site}/wp-json/wp/v2/users/me/application-passwords`, {
    method: 'POST',
    headers: { cookie: cookies, 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'pw-e2e' }),
  });
  const data = await res.json();
  if (!data.password) throw new Error(`create failed: ${JSON.stringify(data)}`);
  return data.password;
}

const lines = [];
for (const [i, site] of sites.entries()) {
  const suffix = i === 0 ? '' : `_${i + 1}`;
  const username = env[`WP_USERNAME${suffix}`] || env.WP_USERNAME;
  const password = env[`WP_ADMIN_PASS${suffix}`] || env.WP_ADMIN_PASS || env.WP_PASSWORD;
  process.stdout.write(`${site} … `);
  try {
    const cookies = await login(site, username, password);
    const nonce = await restNonce(site, cookies);
    const appPass = await createPassword(site, cookies, nonce);
    console.log('ok');
    lines.push(`WP_API_PASS${suffix}="${appPass}"`);
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
  }
}

if (lines.length) {
  console.log('\nAdd/replace these in tests/Playwright/.env:\n');
  console.log(lines.join('\n'));
}
