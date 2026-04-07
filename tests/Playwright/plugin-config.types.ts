export interface CardData {
  number: string;
  name: string;
  shortName: string;
  month: string;
  year: string;
  cvv: string;
  challenge?: boolean;
}

export interface CardFixtures {
  mastercard: CardData;
  visaChallenge: CardData;
  visaFrictionless: CardData;
  visaFrictionlessAttempted: CardData;
  declined: CardData;
  expired: CardData;
}

export interface BillingData {
  firstName: string;
  lastName: string;
  company: string;
  country: string;
  shortCountry: string;
  street: string;
  address2: string;
  city: string;
  state: string;
  shortState: string;
  zipCode: string;
  phone: string;
  email: string;
  password: string;
}

export interface PluginConfig {
  paymentMethodSlug: string;
  paymentMethodSlugsAlt: string[];
  displayName: string;
  settingsOptionName: string;
  mpgsIframePattern: string;
  transactionIdMetaKey: string;
  products: {
    physical: number;
    digital: number;
    subscription: number;
  };
  cards?: Partial<CardFixtures>;
}
