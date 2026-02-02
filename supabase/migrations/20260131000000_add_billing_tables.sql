-- Customer billing information
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Subscription tracking
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  stripe_price_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'active', 'canceled', 'incomplete', 'incomplete_expired',
    'past_due', 'trialing', 'unpaid', 'paused'
  )),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Report credits (for subscription limits and one-time purchases)
CREATE TABLE IF NOT EXISTS public.credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  credits_used_this_period INTEGER NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Payment/transaction history
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_checkout_session_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'gbp',
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('one_time', 'subscription')),
  report_id UUID REFERENCES public.reports(id),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Payment logs for debugging and audit
CREATE TABLE IF NOT EXISTS public.payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  stripe_event_id TEXT UNIQUE,
  payload JSONB,
  processed_at TIMESTAMPTZ DEFAULT now(),
  error TEXT
);

-- Add payment_status to reports table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'reports' 
    AND column_name = 'payment_status'
  ) THEN
    ALTER TABLE public.reports 
    ADD COLUMN payment_status TEXT DEFAULT 'unpaid' 
    CHECK (payment_status IN ('unpaid', 'paid', 'refunded'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'reports' 
    AND column_name = 'payment_id'
  ) THEN
    ALTER TABLE public.reports 
    ADD COLUMN payment_id UUID REFERENCES public.payments(id);
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_credits_user_id ON public.credits(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_checkout_session_id ON public.payments(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_stripe_event_id ON public.payment_logs(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_event_type ON public.payment_logs(event_type);

-- RLS Policies
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;

-- Customers policies
CREATE POLICY "Users can view own customer record"
  ON public.customers FOR SELECT
  USING (auth.uid() = id);

-- Subscriptions policies
CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Credits policies
CREATE POLICY "Users can view own credits"
  ON public.credits FOR SELECT
  USING (auth.uid() = user_id);

-- Payments policies
CREATE POLICY "Users can view own payments"
  ON public.payments FOR SELECT
  USING (auth.uid() = user_id);

-- Function for atomic credit consumption
CREATE OR REPLACE FUNCTION consume_credit(p_user_id UUID, p_report_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_credits_remaining INTEGER;
BEGIN
  SELECT credits_remaining INTO v_credits_remaining
  FROM credits WHERE user_id = p_user_id FOR UPDATE;
  
  IF v_credits_remaining IS NULL OR v_credits_remaining <= 0 THEN
    RETURN FALSE;
  END IF;
  
  UPDATE credits 
  SET credits_remaining = credits_remaining - 1,
      credits_used_this_period = credits_used_this_period + 1,
      updated_at = now()
  WHERE user_id = p_user_id;
  
  UPDATE reports SET payment_status = 'paid' WHERE id = p_report_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment credits used (helper for atomic operations)
CREATE OR REPLACE FUNCTION increment_credits_used(user_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  current_used INTEGER;
BEGIN
  SELECT credits_used_this_period INTO current_used
  FROM credits WHERE user_id = user_id_param;
  
  RETURN COALESCE(current_used, 0) + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
