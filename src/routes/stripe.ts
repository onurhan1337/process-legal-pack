import { Router, Request, Response } from 'express';
import express from 'express';
import Stripe from 'stripe';
import rateLimit from 'express-rate-limit';
import { config } from '../config/env';
import { getStripeClient, isStripeConfigured } from '../services/stripe';
import {
  getOrCreateStripeCustomer,
  handleCheckoutCompleted,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleRefund,
  logPaymentEvent,
  getActiveUserSubscription,
  markSubscriptionCanceled,
} from '../services/billing';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { CheckoutRequest, StripeError } from '../types/billing';
import { supabase } from '../services/supabase';

const router = Router();

const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req: Request) => (req as AuthenticatedRequest).userId || req.ip || 'unknown',
  message: { error: 'Too many checkout requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const portalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req: Request) => (req as AuthenticatedRequest).userId || req.ip || 'unknown',
  message: { error: 'Too many portal requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

function getPriceId(mode: string, planId?: string): string | undefined {
  if (mode === 'subscription' && planId) {
    const prices = config.stripe.prices as Record<string, string>;
    return prices[planId];
  }
  if (mode === 'subscription') {
    return config.stripe.priceProMonthly;
  }
  return config.stripe.priceSingleReport;
}

router.post(
  '/checkout',
  authMiddleware,
  checkoutLimiter,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Payment service not configured' });
      return;
    }

    try {
      const { mode, reportId, planId } = req.body as CheckoutRequest;
      const userId = req.userId!;
      const userEmail = req.userEmail!;

      if (!mode || !['payment', 'subscription'].includes(mode)) {
        res.status(400).json({ error: 'Invalid mode. Must be "payment" or "subscription"' });
        return;
      }

      const stripeCustomerId = await getOrCreateStripeCustomer(userId, userEmail);
      const stripe = getStripeClient();

      if (mode === 'subscription' && planId) {
        const existingSubscription = await getActiveUserSubscription(userId);

        if (existingSubscription?.stripe_subscription_id) {
          if (existingSubscription.plan_id === planId) {
            res.status(400).json({ error: 'You are already on this plan' });
            return;
          }

          try {
            await stripe.subscriptions.retrieve(existingSubscription.stripe_subscription_id);
          } catch (err) {
            const stripeError = err as StripeError;
            if (stripeError.statusCode === 404 || stripeError.code === 'resource_missing') {
              await markSubscriptionCanceled(existingSubscription.id);
              logger.info('Invalid subscription canceled, continuing with new checkout');
            } else {
              throw err;
            }
          }

          logger.info('Creating upgrade checkout session', {
            userId,
            currentPlan: existingSubscription.plan_id,
            newPlan: planId,
            currentUsage: existingSubscription.usage_count,
          });
        }
      }

      const priceId = getPriceId(mode, planId);
      if (!priceId) {
        logger.error('Price ID not configured', { mode, planId });
        res.status(planId ? 400 : 503).json({
          error: planId
            ? `The '${planId}' plan is not configured. Please contact support.`
            : 'Pricing not configured. Please contact support.',
        });
        return;
      }

      const existingSub = mode === 'subscription' ? await getActiveUserSubscription(userId) : null;
      const existingSubToCancel = existingSub?.stripe_subscription_id || '';
      const existingUsageCount = existingSub?.usage_count ?? 0;

      const sessionConfig: Stripe.Checkout.SessionCreateParams = {
        customer: stripeCustomerId,
        mode: mode === 'subscription' ? 'subscription' : 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${config.frontend.url}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.frontend.url}/billing?canceled=true`,
        metadata: {
          user_id: userId,
          report_id: reportId || '',
          plan_id: planId || '',
          upgrade_from_subscription: existingSubToCancel,
          previous_usage_count: existingUsageCount.toString(),
        },
        allow_promotion_codes: true,
      };

      if (mode === 'subscription') {
        sessionConfig.subscription_data = {
          metadata: {
            user_id: userId,
            plan_id: planId || '',
            upgraded_from: existingSubToCancel,
            previous_usage_count: existingUsageCount.toString(),
          },
        };
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);

      logger.info('Checkout session created', {
        userId,
        sessionId: session.id,
        mode,
        planId,
        isUpgrade: !!existingSubToCancel,
      });

      res.json({ url: session.url });
    } catch (error) {
      logger.error('Failed to create checkout session', error);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  }
);

router.post(
  '/portal',
  authMiddleware,
  portalLimiter,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Payment service not configured' });
      return;
    }

    try {
      const stripeCustomerId = await getOrCreateStripeCustomer(req.userId!, req.userEmail!);
      const stripe = getStripeClient();

      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${config.frontend.url}/billing`,
      });

      logger.info('Portal session created', { userId: req.userId, sessionId: session.id });
      res.json({ url: session.url });
    } catch (error) {
      logger.error('Failed to create portal session', error);
      res.status(500).json({ error: 'Failed to create portal session' });
    }
  }
);

export const webhookRouter = Router();

webhookRouter.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Payment service not configured' });
      return;
    }

    const sig = req.headers['stripe-signature'] as string;
    if (!sig) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripeClient();
      event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Webhook signature verification failed', err);
      res.status(400).json({ error: `Webhook Error: ${message}` });
      return;
    }

    const { data: existingLog } = await supabase
      .from('payment_logs')
      .select('id')
      .eq('stripe_event_id', event.id)
      .is('error', null)
      .limit(1)
      .maybeSingle();

    if (existingLog) {
      logger.info('Duplicate webhook event, skipping', { eventId: event.id, eventType: event.type });
      res.json({ received: true, duplicate: true });
      return;
    }

    const eventPayload = event.data.object as unknown as Record<string, unknown>;
    await logPaymentEvent(event.type, event.id, eventPayload);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case 'invoice.payment_succeeded':
          await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;
        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        case 'charge.refunded':
          await handleRefund(event.data.object as Stripe.Charge);
          break;
        default:
          logger.info('Unhandled webhook event type', { eventType: event.type });
      }

      logger.info('Webhook event processed successfully', { eventId: event.id, eventType: event.type });
    } catch (error) {
      logger.error(`Error handling webhook event ${event.type}`, error);
      await logPaymentEvent(
        event.type,
        event.id,
        eventPayload,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    res.json({ received: true });
  }
);

export default router;
