import { Page, TestInfo, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const RESULTS_DIR = 'test-results';

/**
 * Render fetched emails into a page so they show up in that context's trace,
 * video and screenshots, and attach the same HTML to the report.
 *
 * Email assertions run entirely over the `custom/v1/get-mail` endpoint, so on
 * failure there is otherwise nothing to look at — the body that failed the
 * assertion lives only in a variable. Painting it into `emailPage` makes the
 * actual mail visible in the trace timeline next to everything else.
 */
export async function showEmails(page: Page, mails: MailLike[]): Promise<void> {
  if (!mails.length) return;

  const sections = mails.map((m) => `
    <section style="margin:0 0 24px;border:1px solid #d0d7de;border-radius:6px;overflow:hidden">
      <header style="font:12px/1.6 ui-monospace,monospace;padding:8px 12px;background:#f6f8fa;border-bottom:1px solid #d0d7de">
        <div><b>to</b> ${escapeHtml(m.receiver)}</div>
        <div><b>subject</b> ${escapeHtml(m.subject)}</div>
        <div><b>sent</b> ${escapeHtml(String(m.timestamp))}</div>
      </header>
      <div style="padding:12px">${m.message}</div>
    </section>`).join('\n');

  const html = `<div style="font:14px/1.5 system-ui,sans-serif;padding:16px">
    <h1 style="font-size:15px;margin:0 0 16px">${mails.length} email(s) fetched</h1>
    ${sections}
  </div>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded' }).catch(() => {});

  try {
    await test.info().attach('emails.html', { body: html, contentType: 'text/html' });
  } catch {
    /* not inside a test — the rendered page still stands */
  }
}

/** Only the fields showEmails needs, so debug.ts stays independent of wc-api. */
export interface MailLike {
  receiver: string;
  subject: string;
  timestamp: string | number;
  message: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ));
}

/**
 * Values worth seeing while a checkout test runs. Anything undefined or empty is
 * skipped, so callers can pass whatever they happen to have at that point.
 */
export interface OrderContext {
  orderNumber?: string | number;
  transactionId?: string;
  session?: string;
  payDate?: string;
  logOffset?: number;
  total?: string;
  card?: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Print the order's identifying values to the console and attach them to the
 * report. The console copy is what you watch during a run; the attachment is
 * what tells you which order a past failure was about, since the order number
 * and session ID are otherwise only recoverable from the video.
 */
export async function logOrderContext(label: string, ctx: OrderContext): Promise<void> {
  const rows = Object.entries(ctx).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (!rows.length) return;

  const width = Math.max(...rows.map(([k]) => k.length));
  const body = rows.map(([k, v]) => `  ${k.padEnd(width)} : ${String(v)}`).join('\n');

  console.log(`\n  ── ${label} ──\n${body}\n`);

  // test.info() throws outside a running test; logging should never be the
  // reason a test fails.
  try {
    await test.info().attach(`${label}.txt`, { body, contentType: 'text/plain' });
  } catch {
    /* not inside a test, or attachment rejected — console output already stands */
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeLabel(testInfo: TestInfo): string {
  const suite = testInfo.titlePath.slice(0, -1).join(' -- ');
  const title = testInfo.title;
  return `${suite} -- ${title}`.replace(/[^a-z0-9]+/gi, '-').substring(0, 200);
}

/**
 * Capture screenshot + YAML aria snapshot of the page.
 */
export async function dumpSnapshot(page: Page, label: string, selector = 'body') {
  ensureDir(RESULTS_DIR);

  try {
    await page.screenshot({ path: path.join(RESULTS_DIR, label + '.png'), fullPage: true });
    console.log('  📸 Screenshot → ' + path.join(RESULTS_DIR, label + '.png'));
  } catch (e) {
    console.log('  📸 Screenshot failed: ' + (e as Error).message?.substring(0, 100));
  }

  // Aria snapshot — Locator.ariaSnapshot() exists from Playwright 1.49+;
  // older installs throw "is not a function". Skip silently in that case.
  try {
    const locator = page.locator(selector) as any;
    if (typeof locator.ariaSnapshot === 'function') {
      const snap = await locator.ariaSnapshot();
      const filename = path.join(RESULTS_DIR, label + '.yml');
      fs.writeFileSync(filename, snap, 'utf-8');
      console.log('  📋 Snapshot: ' + snap.split('\n').length + ' lines → ' + filename);
    }
  } catch (e) {
    console.log('  📋 Snapshot failed: ' + (e as Error).message?.substring(0, 100));
  }

  try {
    // Dump full page HTML with iframe contents inlined.
    // page.content() may omit dynamically-injected iframes, so we use
    // evaluate to serialize the live DOM, then append iframe contents
    // retrieved via Playwright's cross-origin frame API.
    let html = await page.evaluate(() => document.documentElement.outerHTML);

    // Find each <iframe> tag by index and inject its document content after it
    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();
    // Process in reverse so earlier indices stay valid
    const iframePositions: number[] = [];
    let searchFrom = 0;
    const iframeTagRe = /<iframe\b[^>]*>/gi;
    let tagMatch;
    while ((tagMatch = iframeTagRe.exec(html)) !== null) {
      iframePositions.push(tagMatch.index + tagMatch[0].length);
    }

    for (let i = Math.min(iframeCount, iframePositions.length) - 1; i >= 0; i--) {
      try {
        const frameEl = await iframes.nth(i).elementHandle();
        const frame = await frameEl?.contentFrame();
        if (!frame) continue;
        const frameHtml = await frame.evaluate(() => document.documentElement.outerHTML);
        const src = await iframes.nth(i).getAttribute('src') || '';
        const injection = `\n<!-- #document (iframe[${i}]${src ? ' src="' + src + '"' : ''}) -->\n${frameHtml}\n<!-- /#document -->\n`;
        html = html.slice(0, iframePositions[i]) + injection + html.slice(iframePositions[i]);
      } catch { /* cross-origin or detached */ }
    }

    const htmlFile = path.join(RESULTS_DIR, label + '.html');
    fs.writeFileSync(htmlFile, html, 'utf-8');
    console.log('  🔍 HTML: ' + Math.round(html.length / 1024) + 'KB → ' + htmlFile);
  } catch (e) {
    console.log('  🔍 HTML dump failed: ' + (e as Error).message?.substring(0, 100));
  }
}

/**
 * Collects console messages and network request/response/failure events from the page.
 */
export class PageLog {
  messages: string[] = [];
  requests: string[] = [];

  install(page: Page) {
    page.on('console', msg => {
      this.messages.push('[' + msg.type() + '] ' + msg.text());
    });
    page.on('request', req => {
      this.requests.push('→ ' + req.method() + ' ' + req.url());
    });
    page.on('response', resp => {
      this.requests.push('← ' + resp.status() + ' ' + resp.request().method() + ' ' + resp.url());
    });
    page.on('requestfailed', req => {
      this.requests.push('✘ ' + req.method() + ' ' + req.url() + ' ' + (req.failure()?.errorText || ''));
    });
  }

  drain(): string[] {
    return this.messages.splice(0);
  }

  clear() {
    this.messages = [];
    this.requests = [];
  }
}

/**
 * Dump all debug artifacts for a failed test: screenshot, YML snapshot, console log, network log.
 */
export async function dumpFailureArtifacts(page: Page, testInfo: TestInfo, pageLog?: PageLog) {
  const label = 'FAIL-' + safeLabel(testInfo);
  ensureDir(RESULTS_DIR);

  // Dump the Playwright error with full stack trace
  if (testInfo.error) {
    const errFile = path.join(RESULTS_DIR, label + '-error.txt');
    const errLines = [
      `Test: ${testInfo.titlePath.join(' > ')}`,
      `File: ${testInfo.file}:${testInfo.line}`,
      `Duration: ${testInfo.duration}ms`,
      '',
      testInfo.error.message || '',
      '',
      testInfo.error.stack || '',
    ];
    fs.writeFileSync(errFile, errLines.join('\n'), 'utf-8');
    console.log('  ❌ Error → ' + errFile);
  }

  await dumpSnapshot(page, label);

  if (pageLog) {
    const logs = pageLog.drain();
    if (logs.length > 0) {
      const logFile = path.join(RESULTS_DIR, label + '-console.log');
      fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
      console.log('  📋 Console: ' + logs.length + ' entries → ' + logFile);
    }
    if (pageLog.requests.length > 0) {
      const netFile = path.join(RESULTS_DIR, label + '-network.log');
      fs.writeFileSync(netFile, pageLog.requests.join('\n'), 'utf-8');
      console.log('  🌐 Network: ' + pageLog.requests.length + ' entries → ' + netFile);
    }
  }
}
