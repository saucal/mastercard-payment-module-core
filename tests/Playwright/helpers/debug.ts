import { Page, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const RESULTS_DIR = 'test-results';

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
