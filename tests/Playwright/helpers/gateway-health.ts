import { getLogs } from './wc-api';

/**
 * Telling upstream failures apart from test bugs.
 *
 * This suite talks to test-gateway.mastercard.com, and that call fails
 * occasionally: measured at 7 failures in 4314 requests (0.16%) over one
 * evening, against ~437 gateway requests per full run. WordPress caps the
 * connect phase at 10s (Requests v2 'connect_timeout', which
 * class-wp-http.php never lets the plugin's own 'timeout' => 60 override),
 * so a slow DNS/TLS handshake fails outright.
 *
 * One such failure surfaces in several unrelated-looking ways, which is what
 * makes it so easy to misdiagnose as a test bug:
 *
 *   - "The Payment Session is invalid or has expired"
 *   - "There was an error creating the payment session" / MPGS iframes absent
 *   - checkout never leaves /checkout/
 *   - "session GET card details entry not found"
 *
 * That last one is the sneaky case. The request IS logged, but with no usable
 * response, so a parsed entry reads { response: { body: '' } }. Assertions
 * that match on response.body.<field> cannot see it and report the entry as
 * MISSING rather than FAILED -- which looks exactly like a broken assertion.
 *
 * An empty response body has two known causes, and this helper deliberately
 * does not try to separate them:
 *
 *   1. the gateway call did not complete (cURL error), or
 *   2. the log parser could not decode the response -- see the note on
 *      verifyVoidLog in assertions.ts about multi-line responses.
 *
 * Both mean "not a failed assertion", which is the distinction that actually
 * changes what you do next, so the verdict is worded to cover both rather
 * than claiming a cause it cannot prove.
 */

export interface GatewayFailure {
  type: string;
  url: string;
  date: string;
}

/**
 * Find gateway requests with no usable response between two ISO timestamps
 * (YYYY-MM-DDTHH:MM:SS, matching what the log API emits).
 *
 * Entries carry request.date, so failures are attributed to the test that
 * actually caused them rather than to whatever else ran nearby -- the log API
 * returns a +/-120s window, which at ~30s per test would otherwise span
 * several neighbours. That matters more now that suites run in parallel
 * across installs.
 */
export async function findGatewayFailures(
  startIso: string,
  endIso: string,
): Promise<GatewayFailure[]> {
  const res: any = await getLogs(startIso, '');
  const content: any[] = res?.logs?.[0]?.content ?? [];

  return content
    .filter((entry: any) => {
      const date = entry?.request?.date;
      if (!date || date < startIso || date > endIso) return false;
      // A completed, decodable call always carries a response body.
      const body = entry?.response?.body;
      return body === '' || body === undefined || body === null;
    })
    .map((entry: any) => ({
      type: String(entry?.request?.type ?? '?'),
      url: String(entry?.request?.url ?? '?'),
      date: String(entry?.request?.date ?? '?'),
    }));
}

/**
 * Human-readable verdict for a failed test.
 *
 * Hedged on purpose. Finding a bad gateway entry is strong evidence but not
 * proof the test would otherwise have passed, and the "none found" half is the
 * more actionable one: it means the failure is ours and deserves a real fix
 * rather than another retry.
 */
export function describeGatewayFailures(failures: GatewayFailure[]): string {
  if (!failures.length) {
    return [
      "FLAKINESS VERDICT: no unusable gateway response found in this test's",
      'window, so this failure is most likely test-side -- a race, a selector,',
      'or a real regression -- and should be investigated, not retried away.',
      '',
      'Caveat before you trust that: the log API reads only the ACTIVE log',
      'file, and WooCommerce rotates at 5MB. A full run writes enough to rotate',
      'within a day, and anything already moved to the rotated file is',
      'invisible here -- so "none found" can also mean "could not look".',
      '',
      'If the symptom is one of the gateway ones (expired session, missing',
      'MPGS iframes, a checkout that never advances, a log entry reported as',
      '"not found"), check the raw logs before concluding it is yours:',
      '',
      '  ls wp-content/uploads/wc-logs/*mastercard_merchant_cloud-logs*',
      '  grep -c "cURL error" <the file covering the failure time>',
    ].join('\n');
  }

  const lines = [
    `FLAKINESS VERDICT: ${failures.length} gateway request(s) came back unusable`,
    'during this test.',
    '',
    'Either the call to test-gateway.mastercard.com did not complete, or the',
    'log parser could not decode the response. Either way it is not a failed',
    'assertion: it surfaces as an expired/invalid payment session, missing',
    'MPGS iframes, a checkout that never advances, or a log entry reported as',
    '"not found" when it is really "not decodable".',
    '',
  ];
  for (const f of failures) {
    lines.push(`  ${f.date}  ${f.type}  ${f.url}`);
  }
  return lines.join('\n');
}
