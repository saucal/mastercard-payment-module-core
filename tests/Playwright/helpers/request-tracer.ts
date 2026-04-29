/**
 * Request tracer for Playwright tests.
 *
 * Uses CDP (Chrome DevTools Protocol) Network.requestWillBeSent to capture
 * request initiators -- the JS call stack that triggered each network request.
 * Falls back to page.on('request') on non-Chromium browsers.
 */

import { Page } from '@playwright/test';

interface TracedRequest {
  timestamp: number;
  method: string;
  url: string;
  type: string;
  initiatorType: string;
  initiatorStack: string[];
  postData?: string;
}

export class RequestTracer {
  private requests: TracedRequest[] = [];
  private cdpSession: any = null;
  private page: Page;
  private _onRequestWillBeSent: ((params: any) => void) | null = null;

  private constructor(page: Page) {
    this.page = page;
  }

  static async attach(page: Page): Promise<RequestTracer> {
    const tracer = new RequestTracer(page);
    try {
      const context = page.context();
      tracer.cdpSession = await context.newCDPSession(page);
      await tracer.cdpSession.send('Network.enable');

      tracer._onRequestWillBeSent = (params: any) => {
        tracer._handleRequest(params);
      };
      tracer.cdpSession.on('Network.requestWillBeSent', tracer._onRequestWillBeSent);
    } catch {
      console.log('  [tracer] CDP not available, falling back to page.on("request")');
      page.on('request', (req) => {
        tracer.requests.push({
          timestamp: Date.now(),
          method: req.method(),
          url: req.url(),
          type: req.resourceType(),
          initiatorType: 'unknown',
          initiatorStack: [],
          postData: req.postData() || undefined,
        });
      });
    }
    return tracer;
  }

  private _handleRequest(params: any) {
    const { request, initiator, type } = params;
    const stack: string[] = [];

    if (initiator?.stack?.callFrames) {
      for (const frame of initiator.stack.callFrames) {
        const fn = frame.functionName || '(anonymous)';
        const file = (frame.url || '').split('/').pop() || '';
        const line = frame.lineNumber + 1;
        stack.push(`${fn} @ ${file}:${line}`);
      }
    }

    this.requests.push({
      timestamp: params.wallTime ? params.wallTime * 1000 : Date.now(),
      method: request.method,
      url: request.url,
      type: type || 'unknown',
      initiatorType: initiator?.type || 'unknown',
      initiatorStack: stack,
      postData: request.postData || undefined,
    });
  }

  dump(label?: string) {
    const tag = label ? ` (${label})` : '';
    console.log(`\n  -- Request Trace${tag}: ${this.requests.length} requests --`);
    for (const req of this.requests) {
      this._printRequest(req);
    }
    console.log('  -- End Trace --\n');
  }

  dumpFiltered(urlFilter: string, label?: string) {
    const filtered = this.requests.filter(r => r.url.includes(urlFilter));
    const tag = label ? ` (${label})` : '';
    console.log(`\n  -- Request Trace${tag} [${urlFilter}]: ${filtered.length}/${this.requests.length} --`);
    for (const req of filtered) {
      this._printRequest(req);
    }
    console.log('  -- End Trace --\n');
  }

  filter(urlFilter: string): TracedRequest[] {
    return this.requests.filter(r => r.url.includes(urlFilter));
  }

  all(): TracedRequest[] {
    return [...this.requests];
  }

  clear() {
    this.requests = [];
  }

  async detach() {
    if (this.cdpSession) {
      try {
        await this.cdpSession.detach();
      } catch { /* page may already be closed */ }
      this.cdpSession = null;
    }
  }

  private _printRequest(req: TracedRequest) {
    let shortUrl = req.url;
    try {
      const u = new URL(req.url);
      shortUrl = u.pathname + (u.search ? u.search.substring(0, 80) : '');
    } catch { /* keep full URL */ }

    const postInfo = req.postData
      ? ` POST[${req.postData.substring(0, 300)}${req.postData.length > 300 ? '...' : ''}]`
      : '';

    console.log(`  ${req.method} ${shortUrl}${postInfo}`);
    console.log(`    type=${req.type} initiator=${req.initiatorType}`);

    if (req.initiatorStack.length > 0) {
      const frames = req.initiatorStack.slice(0, 5);
      console.log(`    stack: ${frames.join(' -> ')}`);
    }
  }
}
