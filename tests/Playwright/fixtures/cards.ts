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
};

export function fourDigits(card: CardData): string {
  return card.number.slice(-4);
}

export function sixDigits(card: CardData): string {
  return card.number.slice(0, 6);
}
