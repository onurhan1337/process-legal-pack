import Stripe from 'stripe';

export type PlanId = 'trial' | 'starter' | 'professional' | 'expired';

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  priceMonthly: number;
  currency: string;
  maxSeats: number;
  trialDays: number;
  trialCredits: number;
  reportsPerMonth: number;
  features: string[];
  isActive: boolean;
  displayOrder: number;
}

export interface UserAccess {
  hasAccess: boolean;
  isTrial: boolean;
  isUnlimited: boolean;
  creditsRemaining: number;
  planId: PlanId;
  trialEndsAt: Date | null;
  usageCount: number;
  usageLimit: number;
  periodEndsAt: Date | null;
}

export interface TrialInfo {
  endsAt: string | null;
  creditsTotal: number;
  creditsUsed: number;
  creditsRemaining: number;
  daysRemaining: number;
}

export interface UsageInfo {
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  periodEndsAt: string | null;
}

export interface BillingStatusResponse {
  access: UserAccess;
  trial: TrialInfo | null;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    planId: PlanId | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    usageCount: number;
    usageLimit: number | null;
  } | null;
  usage: UsageInfo | null;
}

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'trialing'
  | 'unpaid'
  | 'paused';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export type PaymentType = 'one_time' | 'subscription';

export type ReportPaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface Customer {
  id: string;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  plan_id: string | null;
  usage_count: number;
  usage_limit: number;
  created_at: string;
  updated_at: string;
}

export interface Credits {
  id: string;
  user_id: string;
  credits_remaining: number;
  credits_used_this_period: number;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payment_type: PaymentType;
  report_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PaymentLog {
  id: string;
  event_type: string;
  stripe_event_id: string | null;
  payload: Record<string, unknown> | null;
  processed_at: string;
  error: string | null;
}

export interface BillingStatus {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  credits: {
    remaining: number;
    usedThisPeriod: number;
    periodStart: string | null;
    periodEnd: string | null;
  } | null;
  hasActiveSubscription: boolean;
  canProcessReport: boolean;
}

export interface CheckoutRequest {
  mode: 'payment' | 'subscription';
  reportId?: string;
  planId?: string;
}

export interface CheckoutResponse {
  url: string;
}

export interface PortalResponse {
  url: string;
}

export interface CheckoutMetadata {
  user_id: string;
  report_id: string;
  plan_id: string;
  upgrade_from_subscription: string;
  previous_usage_count: string;
}

export interface SubscriptionMetadata {
  user_id: string;
  plan_id: string;
  upgraded_from: string;
  previous_usage_count: string;
}

export interface ExistingSubscription {
  id: string;
  stripe_subscription_id: string;
  plan_id: string;
  status: string;
  usage_limit: number;
  usage_count: number;
}

export interface StripeError extends Error {
  statusCode?: number;
  code?: string;
}

export type StripeCheckoutSession = Stripe.Checkout.Session;
export type StripeInvoice = Stripe.Invoice;
export type StripeSubscription = Stripe.Subscription;
export type StripeCharge = Stripe.Charge;
