import type { BillingData } from '../plugin-config.types';

export const billing: BillingData = {
  firstName: 'QA',
  lastName: 'Test',
  company: 'Saucal Inc.',
  country: 'United States (US)',
  shortCountry: 'US',
  street: '123 Flase Street',
  address2: 'Apartment 2',
  city: 'Miami',
  state: 'Florida',
  shortState: 'FL',
  zipCode: '33126',
  phone: '3050698798',
  email: 'qa@saucal.com',
  password: 'fric2171Biot',
};

export function uniqueEmail(): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `qa+gi_order_${rand}@saucal.com`;
}
