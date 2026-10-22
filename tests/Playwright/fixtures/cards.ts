import type { CardData } from '../plugin-config.types';

export const cards: Record<string, CardData> = {
  mastercard: {
    number: '5123456789012346',
    name: 'MasterCard',
    shortName: 'MASTERCARD',
    month: '01',
    year: '39',
    cvv: '100',
  },
  mastercard2: {
    number: '5555555555000018',
    name: 'MasterCard',
    shortName: 'MASTERCARD',
    month: '01',
    year: '39',
    cvv: '100',
  },
  mastercard3: {
    number: '5123450000000008',
    name: 'MasterCard',
    shortName: 'MASTERCARD',
    month: '01',
    year: '39',
    cvv: '100',
    challenge: true,
  },
  visaChallenge: {
    number: '4440000009900010',
    name: 'Visa',
    shortName: 'VISA',
    month: '01',
    year: '39',
    cvv: '100',
    challenge: true,
  },
  visaFrictionless: {
    number: '4440000042200014',
    name: 'Visa',
    shortName: 'VISA',
    month: '01',
    year: '39',
    cvv: '100',
    challenge: false,
  },
  visaFrictionlessAttempted: {
    number: '4440000042200022',
    name: 'Visa',
    shortName: 'VISA',
    month: '01',
    year: '39',
    cvv: '100',
    challenge: false,
  },
  /**
   * DCC fixtures. Each quotes in a currency other than the store's, which is what
   * draws a conversion offer at all — that is a property of the BIN at MPGS, not
   * something the suite controls.
   */
  /**
   * DCC test card, base currency USD: quotes in EUR, frictionless success
   * (developer.mastercard.com/mastercard-gateway/documentation/testing/test-cards/dcc-pay-pot-inq-tc/tc-usd/).
   *
   * The DCC suites use this rather than a Visa card for a reason beyond it
   * being a documented DCC card. On TESTSAUCAL101 a stored Visa card gets a VTS
   * scheme token that turns ACTIVE within a minute, and from then on every DCC
   * quote against the stored token is rejected at PAY ("requestId is
   * invalid") — including the documented Visa EUR card 4907449999991296. This
   * Mastercard's scheme token stays PROVISIONING and quotes against it pay.
   * Probed 2026-09-30; raised with Mastercard.
   */
  mastercardEurFrictionless: {
    number: '5490019999991271',
    name: 'MasterCard',
    shortName: 'MASTERCARD',
    month: '01',
    year: '39',
    cvv: '100',
    challenge: false,
  },
  mastercardMxnChallenge: {
    number: '5288049999998964',
    name: 'MasterCard',
    shortName: 'MASTERCARD',
    month: '01',
    year: '39',
    cvv: '100',
    challenge: true,
  },
  visaHkdFrictionless: {
    number: '4541879999990975',
    name: 'Visa',
    shortName: 'VISA',
    month: '01',
    year: '39',
    cvv: '100',
    challenge: false,
  },

  declined: {
    number: '5123456789012346',
    name: 'MasterCard',
    shortName: 'MASTERCARD',
    month: '05',
    year: '39',
    cvv: '100',
  },
  expired: {
    number: '5555555555000018',
    name: 'MasterCard',
    shortName: 'MASTERCARD',
    month: '04',
    year: '27',
    cvv: '100',
  },
  invalidCC: {
    number: '7554298042803978',
    name: 'Invalid',
    shortName: 'UNKNOWN',
    month: '01',
    year: '39',
    cvv: '100',
  },
};

export function fourDigits(card: CardData): string {
  return card.number.slice(-4);
}

export function sixDigits(card: CardData): string {
  return card.number.slice(0, 6);
}
