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
  // Price IDs are validated where they are used — requiring the legacy price
  // vars here would 503 every billing endpoint even with valid new-plan prices.
  return Boolean(config.stripe.secretKey && config.stripe.webhookSecret);
}
