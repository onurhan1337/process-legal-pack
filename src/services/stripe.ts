import Stripe from 'stripe';
import { config } from '../config/env';

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    if (!config.stripe.secretKey) {
      throw new Error('Stripe secret key is not configured');
    }
    stripeClient = new Stripe(config.stripe.secretKey);
  }
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(
    config.stripe.secretKey &&
    config.stripe.webhookSecret &&
    config.stripe.priceSingleReport &&
    config.stripe.priceProMonthly
  );
}
