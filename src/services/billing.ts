import { logger } from '../utils/logger';
import { supabase } from './supabase';
import { getStripeClient } from './stripe';
import type {
  StripeCheckoutSession,
  StripeInvoice,
  StripeSubscription,
  StripeCharge,
  Plan,
  PlanId,
  UserAccess,
  UsageInfo,
  ExistingSubscription,
} from '../types/billing';

const MONTHLY_CREDITS = 5;
const PLAN_LIMITS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_PLAN_LIMITS: Record<string, number> = { starter: 100, professional: 300 };

let planLimitsCache: Record<string, number> | null = null;
let planLimitsCacheExpiry = 0;

// ============================================================================
// Plan & Usage Helpers
// ============================================================================

async function getPlanUsageLimit(planId: string): Promise<number> {
  const now = Date.now();

  if (!planLimitsCache || now > planLimitsCacheExpiry) {
    const { data: plans } = await supabase
      .from('plans')
      .select('id, usage_limit')
      .eq('is_active', true);

    if (plans?.length) {
      planLimitsCache = Object.fromEntries(plans.map((p) => [p.id, p.usage_limit]));
      planLimitsCacheExpiry = now + PLAN_LIMITS_CACHE_TTL;
    }
  }

  return planLimitsCache?.[planId] ?? DEFAULT_PLAN_LIMITS[planId] ?? 100;
}

function toISOString(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

// ============================================================================
// Database Helpers (exported for use in routes)
// ============================================================================

export async function getActiveUserSubscription(userId: string): Promise<ExistingSubscription | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('id, stripe_subscription_id, plan_id, status, usage_limit, usage_count')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

export async function markSubscriptionCanceled(subscriptionId: string): Promise<void> {
  await supabase
    .from('subscriptions')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', subscriptionId);
}

// ============================================================================
// User Access
// ============================================================================

export async function checkUserAccess(userId: string): Promise<UserAccess> {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscription) {
    let usageLimit = subscription.usage_limit;
    if (usageLimit === null || usageLimit === undefined) {
      usageLimit = await getPlanUsageLimit(subscription.plan_id);
    }

    const usageCount = subscription.usage_count ?? 0;
    const usageRemaining = Math.max(0, usageLimit - usageCount);
    const isUnlimited = usageLimit === -1;

    return {
      hasAccess: isUnlimited || usageRemaining > 0,
      isTrial: false,
      isUnlimited,
      creditsRemaining: isUnlimited ? -1 : usageRemaining,
      planId: (subscription.plan_id as PlanId) || 'starter',
      trialEndsAt: null,
      usageCount,
      usageLimit: isUnlimited ? -1 : usageLimit,
      periodEndsAt: subscription.current_period_end ? new Date(subscription.current_period_end) : null,
    };
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (customer?.trial_ends_at) {
    const trialEndsAt = new Date(customer.trial_ends_at);
    if (trialEndsAt.getTime() > Date.now()) {
      const usageCount = customer.trial_usage_count ?? 0;
      const usageLimit = customer.trial_usage_limit ?? 3;
      const usageRemaining = Math.max(0, usageLimit - usageCount);

      return {
        hasAccess: usageRemaining > 0,
        isTrial: true,
        isUnlimited: false,
        creditsRemaining: usageRemaining,
        planId: 'trial' as PlanId,
        trialEndsAt,
        usageCount,
        usageLimit,
        periodEndsAt: trialEndsAt,
      };
    }
  }

  return {
    hasAccess: false,
    isTrial: false,
    isUnlimited: false,
    creditsRemaining: 0,
    planId: 'expired' as PlanId,
    trialEndsAt: null,
    usageCount: 0,
    usageLimit: 0,
    periodEndsAt: null,
  };
}

// ============================================================================
// Usage & Credits
// ============================================================================

export async function consumeUsage(userId: string, reportId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('consume_usage', {
    p_user_id: userId,
    p_report_id: reportId,
  });

  if (error) {
    logger.error('Failed to consume usage', error, { userId, reportId });
    return false;
  }

  logger.info('Usage consumed', { userId, reportId });
  return data === true;
}

export function calculateUsageInfo(access: UserAccess): UsageInfo | null {
  if (access.isTrial || access.usageLimit > 0) {
    const remaining = Math.max(0, access.usageLimit - access.usageCount);
    return {
      used: access.usageCount,
      limit: access.usageLimit,
      remaining,
      percentUsed: access.usageLimit > 0 ? Math.round((access.usageCount / access.usageLimit) * 100) : 0,
      periodEndsAt: access.periodEndsAt?.toISOString() || null,
    };
  }

  return null;
}

export async function consumeTrialCredit(userId: string, reportId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('consume_trial_credit', {
    p_user_id: userId,
    p_report_id: reportId,
  });

  if (error) {
    logger.error('Failed to consume trial credit', error, { userId, reportId });
    return false;
  }

  logger.info('Trial credit consumed', { userId, reportId });
  return data === true;
}

export type ConsumedCreditType = 'trial' | 'usage';

export async function refundConsumedCredit(
  userId: string,
  reportId: string,
  type: ConsumedCreditType
): Promise<void> {
  const rpcName = type === 'trial' ? 'refund_trial_credit' : 'refund_usage';
  const { error } = await supabase.rpc(rpcName, {
    p_user_id: userId,
    p_report_id: reportId,
  });

  if (error) {
    logger.error('Failed to refund consumed credit', error, { userId, reportId, type });
    return;
  }

  logger.info('Consumed credit refunded after processing failure', { userId, reportId, type });
}

export async function initializeUserTrial(userId: string): Promise<void> {
  const { error } = await supabase.rpc('initialize_user_trial', { p_user_id: userId });

  if (error) {
    logger.error('Failed to initialize user trial', error, { userId });
    throw new Error('Failed to initialize user trial');
  }

  logger.info('User trial initialized', { userId });
}

// ============================================================================
// Plans & Customers
// ============================================================================

interface DbPlan {
  id: string;
  name: string;
  description: string | null;
  price_monthly: number;
  currency: string;
  usage_limit: number;
  trial_days: number;
  features: string[] | null;
  is_active: boolean;
  display_order: number;
}

function mapDbPlanToPlan(dbPlan: DbPlan): Plan {
  return {
    id: dbPlan.id as PlanId,
    name: dbPlan.name,
    description: dbPlan.description || '',
    priceMonthly: dbPlan.price_monthly,
    currency: dbPlan.currency,
    maxSeats: 1,
    trialDays: dbPlan.trial_days,
    trialCredits: dbPlan.usage_limit,
    reportsPerMonth: dbPlan.usage_limit,
    features: dbPlan.features || [],
    isActive: dbPlan.is_active,
    displayOrder: dbPlan.display_order,
  };
}

export async function getPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('display_order');

  if (error) {
    logger.error('Failed to fetch plans', error);
    return [];
  }

  return (data || []).map(mapDbPlanToPlan);
}

export async function getCustomer(userId: string) {
  const { data } = await supabase.from('customers').select('*').eq('id', userId).single();
  return data;
}

export async function getActiveSubscription(userId: string) {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data;
}

export async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const { data: customer } = await supabase
    .from('customers')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

  if (customer?.stripe_customer_id) {
    return customer.stripe_customer_id;
  }

  const stripe = getStripeClient();
  const stripeCustomer = await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId },
  });

  await supabase.from('customers').upsert({ id: userId, stripe_customer_id: stripeCustomer.id });

  return stripeCustomer.id;
}

// ============================================================================
// Webhook Handlers
// ============================================================================

export async function handleCheckoutCompleted(session: StripeCheckoutSession): Promise<void> {
  const userId = session.metadata?.user_id;
  const reportId = session.metadata?.report_id;
  const planId = session.metadata?.plan_id;
  const upgradeFromSubscription = session.metadata?.upgrade_from_subscription;
  const previousUsageCount = parseInt(session.metadata?.previous_usage_count || '0', 10);

  if (!userId) {
    logger.error('Checkout session missing user_id in metadata', undefined, { sessionId: session.id });
    return;
  }

  const { data: existingPayment } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .single();

  if (existingPayment) {
    logger.info('Payment already processed, skipping', { sessionId: session.id });
    return;
  }

  const { error: paymentError } = await supabase.from('payments').insert({
    user_id: userId,
    stripe_payment_intent_id: session.payment_intent as string,
    stripe_checkout_session_id: session.id,
    amount: session.amount_total || 0,
    currency: session.currency || 'gbp',
    status: 'succeeded',
    payment_type: session.mode === 'subscription' ? 'subscription' : 'one_time',
    report_id: reportId || null,
    metadata: {
      customer_email: session.customer_details?.email,
      customer_id: session.customer,
      plan_id: planId,
      is_upgrade: !!upgradeFromSubscription,
      previous_usage_count: previousUsageCount,
    },
  });

  if (paymentError) {
    logger.error('Failed to create payment record', paymentError, { sessionId: session.id });
    throw paymentError;
  }

  if (session.mode === 'payment' && reportId) {
    await supabase.from('reports').update({ payment_status: 'paid' }).eq('id', reportId);
    logger.info('Report marked as paid', { reportId });
  }

  if (session.mode === 'subscription') {
    if (upgradeFromSubscription) {
      try {
        const stripe = getStripeClient();
        await stripe.subscriptions.cancel(upgradeFromSubscription, { prorate: true });

        await supabase
          .from('subscriptions')
          .update({ status: 'canceled', canceled_at: new Date().toISOString() })
          .eq('stripe_subscription_id', upgradeFromSubscription);

        logger.info('Old subscription canceled for upgrade', {
          userId,
          oldSubscriptionId: upgradeFromSubscription,
          newSubscriptionId: session.subscription,
          preservedUsage: previousUsageCount,
        });
      } catch (cancelError) {
        logger.error('Failed to cancel old subscription during upgrade', cancelError, {
          userId,
          oldSubscriptionId: upgradeFromSubscription,
        });
      }
    }

    await initializeSubscriptionCredits(userId, session.subscription as string, planId || undefined);

    if (planId) {
      await supabase.from('customers').update({ current_plan_id: planId }).eq('id', userId);
    }
  }

  logger.info('Checkout completed successfully', {
    userId,
    sessionId: session.id,
    mode: session.mode,
    planId,
    isUpgrade: !!upgradeFromSubscription,
  });
}

export async function handleSubscriptionCreated(webhookSubscription: StripeSubscription): Promise<void> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(webhookSubscription.id);

  const stripeCustomerId = subscription.customer as string;
  const planId = subscription.metadata?.plan_id || 'starter';
  const upgradedFrom = subscription.metadata?.upgraded_from;
  const previousUsageCount = parseInt(subscription.metadata?.previous_usage_count || '0', 10);

  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id, usage_count, usage_limit, plan_id')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();

  if (existingSub) {
    logger.info('Subscription already exists, skipping creation', {
      subscriptionId: subscription.id,
      existingPlan: existingSub.plan_id,
    });
    return;
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (!customer) {
    logger.error('Customer not found for subscription', undefined, { stripeCustomerId, subscriptionId: subscription.id });
    return;
  }

  const userId = customer.id;
  const usageLimit = await getPlanUsageLimit(planId);
  const isUpgrade = !!upgradedFrom;
  const usageCount = isUpgrade ? previousUsageCount : 0;

  const canceledAt =
    typeof subscription.canceled_at === 'number' && subscription.canceled_at > 0
      ? toISOString(subscription.canceled_at)
      : null;

  const { error: subError } = await supabase.from('subscriptions').insert({
    user_id: userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: stripeCustomerId,
    stripe_price_id: subscription.items.data[0]?.price.id || '',
    status: subscription.status,
    current_period_start: toISOString(subscription.current_period_start),
    current_period_end: toISOString(subscription.current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    canceled_at: canceledAt,
    plan_id: planId,
    usage_count: usageCount,
    usage_limit: usageLimit,
  });

  if (subError) {
    if (subError.code === '23505') {
      logger.info('Subscription already created by concurrent process', { subscriptionId: subscription.id });
      return;
    }
    logger.error('Failed to create subscription', subError, { userId, subscriptionId: subscription.id });
    throw subError;
  }

  await supabase.from('customers').update({ current_plan_id: planId }).eq('id', userId);
  await initializeSubscriptionCredits(userId, subscription.id, planId);

  logger.info('Subscription created successfully', { userId, subscriptionId: subscription.id, planId, usageLimit, isUpgrade, usageCount });
}

export async function handleSubscriptionUpdated(webhookSubscription: StripeSubscription): Promise<void> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(webhookSubscription.id);
  const newPlanId = subscription.metadata?.plan_id;

  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan_id, usage_count, usage_limit')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();

  if (!existingSub) {
    logger.warn('Subscription not found for update, attempting to create', { subscriptionId: subscription.id });
    await handleSubscriptionCreated(webhookSubscription);
    return;
  }

  const canceledAt = subscription.canceled_at ? toISOString(subscription.canceled_at) : null;
  const isUpgrade = newPlanId && newPlanId !== existingSub.plan_id;

  const updateData: Record<string, unknown> = {
    status: subscription.status,
    stripe_price_id: subscription.items.data[0]?.price.id || existingSub.plan_id,
    current_period_start: toISOString(subscription.current_period_start),
    current_period_end: toISOString(subscription.current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    canceled_at: canceledAt,
    updated_at: new Date().toISOString(),
  };

  if (newPlanId) {
    updateData.plan_id = newPlanId;
    if (isUpgrade) {
      updateData.usage_limit = await getPlanUsageLimit(newPlanId);
      logger.info('Plan upgrade detected', {
        subscriptionId: subscription.id,
        oldPlan: existingSub.plan_id,
        newPlan: newPlanId,
        preservedUsage: existingSub.usage_count,
      });
    }
  }

  const { error } = await supabase
    .from('subscriptions')
    .update(updateData)
    .eq('stripe_subscription_id', subscription.id);

  if (error) {
    logger.error('Failed to update subscription', error, { subscriptionId: subscription.id });
    throw error;
  }

  if (newPlanId && existingSub.user_id) {
    await supabase.from('customers').update({ current_plan_id: newPlanId }).eq('id', existingSub.user_id);
  }

  logger.info('Subscription updated successfully', {
    subscriptionId: subscription.id,
    status: subscription.status,
    planId: newPlanId || existingSub.plan_id,
    isUpgrade,
    usagePreserved: existingSub.usage_count,
  });
}

export async function handleSubscriptionDeleted(webhookSubscription: StripeSubscription): Promise<void> {
  const stripe = getStripeClient();
  let subscription: StripeSubscription;

  try {
    subscription = await stripe.subscriptions.retrieve(webhookSubscription.id);
  } catch {
    subscription = webhookSubscription;
  }

  const canceledAt = subscription.canceled_at
    ? toISOString(subscription.canceled_at)
    : new Date().toISOString();

  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'canceled', canceled_at: canceledAt, updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subscription.id);

  if (error) {
    logger.error('Failed to cancel subscription', error, { subscriptionId: subscription.id });
    throw error;
  }

  logger.info('Subscription canceled', { subscriptionId: subscription.id });
}

export async function handleInvoicePaymentSucceeded(invoice: StripeInvoice): Promise<void> {
  if (!invoice.subscription) return;

  const customerId = invoice.customer as string;

  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!customer) {
    logger.error('Customer not found for invoice', undefined, { customerId, invoiceId: invoice.id });
    return;
  }

  const userId = customer.id;

  const { data: existingPayment } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', invoice.payment_intent as string)
    .single();

  if (!existingPayment) {
    await supabase.from('payments').insert({
      user_id: userId,
      stripe_payment_intent_id: invoice.payment_intent as string,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: 'succeeded',
      payment_type: 'subscription',
      metadata: { invoice_id: invoice.id, subscription_id: invoice.subscription },
    });
  }

  if (invoice.billing_reason === 'subscription_cycle') {
    await resetSubscriptionCredits(userId, invoice.subscription as string);

    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);

    await supabase.rpc('reset_subscription_usage', {
      p_stripe_subscription_id: invoice.subscription as string,
      p_period_start: toISOString(subscription.current_period_start),
      p_period_end: toISOString(subscription.current_period_end),
    });

    logger.info('Usage and credits reset for subscription renewal', { userId, subscriptionId: invoice.subscription });
  }

  logger.info('Invoice payment succeeded', { userId, invoiceId: invoice.id });
}

export async function handleInvoicePaymentFailed(invoice: StripeInvoice): Promise<void> {
  if (!invoice.subscription) return;

  await supabase
    .from('subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', invoice.subscription as string);

  logger.warn('Invoice payment failed', undefined, { invoiceId: invoice.id, subscriptionId: invoice.subscription as string });
}

export async function handleRefund(charge: StripeCharge): Promise<void> {
  const { data: payment } = await supabase
    .from('payments')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent_id', charge.payment_intent as string)
    .select('report_id, user_id')
    .single();

  if (payment?.report_id) {
    await supabase.from('reports').update({ payment_status: 'refunded' }).eq('id', payment.report_id);
    logger.info('Report marked as refunded', { reportId: payment.report_id });
  }

  logger.info('Refund processed', { chargeId: charge.id, paymentIntentId: charge.payment_intent as string });
}

// ============================================================================
// Credits Management
// ============================================================================

async function initializeSubscriptionCredits(userId: string, subscriptionId: string, planId?: string): Promise<void> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const isPaidPlan = planId === 'starter' || planId === 'professional';

  await supabase.from('credits').upsert({
    user_id: userId,
    credits_remaining: isPaidPlan ? -1 : MONTHLY_CREDITS,
    credits_used_this_period: 0,
    period_start: toISOString(subscription.current_period_start),
    period_end: toISOString(subscription.current_period_end),
    credit_type: 'subscription',
    is_unlimited: isPaidPlan,
  });

  logger.info('Credits initialized', { userId, credits: isPaidPlan ? 'unlimited' : MONTHLY_CREDITS, planId });
}

async function resetSubscriptionCredits(userId: string, subscriptionId: string): Promise<void> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const { data: credits } = await supabase
    .from('credits')
    .select('is_unlimited')
    .eq('user_id', userId)
    .maybeSingle();

  await supabase
    .from('credits')
    .update({
      // Unlimited (paid-plan) rows keep -1; resetting them to a finite number
      // would silently downgrade the plan on renewal.
      credits_remaining: credits?.is_unlimited ? -1 : MONTHLY_CREDITS,
      credits_used_this_period: 0,
      period_start: toISOString(subscription.current_period_start),
      period_end: toISOString(subscription.current_period_end),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  logger.info('Credits reset', { userId, credits: credits?.is_unlimited ? 'unlimited' : MONTHLY_CREDITS });
}

export async function checkReportPaymentStatus(reportId: string, userId: string): Promise<boolean> {
  const { data: report } = await supabase
    .from('reports')
    .select('payment_status')
    .eq('id', reportId)
    .eq('user_id', userId)
    .single();

  return report?.payment_status === 'paid';
}

export async function logPaymentEvent(
  eventType: string,
  eventId: string,
  payload: Record<string, unknown>,
  error?: string
): Promise<void> {
  await supabase.from('payment_logs').insert({
    event_type: eventType,
    stripe_event_id: eventId,
    payload,
    error,
  });
}
