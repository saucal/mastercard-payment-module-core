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

  try {
    const snap = await page.locator(selector).ariaSnapshot();
    const filename = path.join(RESULTS_DIR, label + '.yml');
    fs.writeFileSync(filename, snap, 'utf-8');
    console.log('  📋 Snapshot: ' + snap.split('\n').length + ' lines → ' + filename);
  } catch (e) {
    console.log('  📋 Snapshot failed: ' + (e as Error).message?.substring(0, 100));
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
