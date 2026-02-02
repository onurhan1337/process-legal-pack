CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_monthly INTEGER NOT NULL,
  currency TEXT DEFAULT 'gbp',
  max_seats INTEGER NOT NULL DEFAULT 1,
  trial_days INTEGER DEFAULT 0,
  trial_credits INTEGER DEFAULT 0,
  reports_per_month INTEGER DEFAULT -1,
  features JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.plans (id, name, description, price_monthly, max_seats, trial_days, trial_credits, reports_per_month, features, display_order) VALUES
('trial', 'Free Trial', '14-day free trial with 3 reports', 0, 2, 14, 3, 3, '["AI-powered legal pack analysis", "Risk assessment scoring", "Document chat assistant"]', 0),
('starter', 'Starter', 'Perfect for individual solicitors or small partnerships', 9900, 2, 0, 0, -1, '["Unlimited property analysis", "AI-powered legal pack review", "Risk assessment scoring", "Document chat assistant", "Email support"]', 1),
('professional', 'Professional', 'Ideal for small legal practices', 19900, 6, 0, 0, -1, '["Everything in Starter", "Up to 6 users", "Priority support", "Advanced analytics"]', 2)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  max_seats = EXCLUDED.max_seats,
  trial_days = EXCLUDED.trial_days,
  trial_credits = EXCLUDED.trial_credits,
  reports_per_month = EXCLUDED.reports_per_month,
  features = EXCLUDED.features,
  display_order = EXCLUDED.display_order;

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES public.plans(id),
ADD COLUMN IF NOT EXISTS seats_used INTEGER DEFAULT 1;

ALTER TABLE public.credits
ADD COLUMN IF NOT EXISTS credit_type TEXT DEFAULT 'subscription' CHECK (credit_type IN ('trial', 'subscription')),
ADD COLUMN IF NOT EXISTS is_unlimited BOOLEAN DEFAULT false;

ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trial_credits_total INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS trial_credits_used INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_plan_id TEXT REFERENCES public.plans(id) DEFAULT 'trial';

CREATE OR REPLACE FUNCTION check_user_access(p_user_id UUID)
RETURNS TABLE (
  has_access BOOLEAN,
  is_trial BOOLEAN,
  is_unlimited BOOLEAN,
  credits_remaining INTEGER,
  plan_id TEXT,
  trial_ends_at TIMESTAMPTZ
) AS $$
DECLARE
  v_customer RECORD;
  v_subscription RECORD;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_user_id;
  
  SELECT * INTO v_subscription FROM subscriptions 
  WHERE user_id = p_user_id AND status IN ('active', 'trialing')
  ORDER BY created_at DESC LIMIT 1;
  
  IF v_subscription IS NOT NULL THEN
    RETURN QUERY SELECT 
      true, false, true, -1, v_subscription.plan_id, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  
  IF v_customer IS NOT NULL AND v_customer.trial_ends_at > now() THEN
    RETURN QUERY SELECT 
      (v_customer.trial_credits_total - v_customer.trial_credits_used) > 0,
      true, false,
      v_customer.trial_credits_total - v_customer.trial_credits_used,
      'trial'::TEXT,
      v_customer.trial_ends_at;
    RETURN;
  END IF;
  
  RETURN QUERY SELECT false, false, false, 0, 'expired'::TEXT, v_customer.trial_ends_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION consume_trial_credit(p_user_id UUID, p_report_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_remaining INTEGER;
BEGIN
  SELECT (trial_credits_total - trial_credits_used) INTO v_remaining
  FROM customers WHERE id = p_user_id FOR UPDATE;
  
  IF v_remaining IS NULL OR v_remaining <= 0 THEN
    RETURN FALSE;
  END IF;
  
  UPDATE customers 
  SET trial_credits_used = trial_credits_used + 1
  WHERE id = p_user_id;
  
  UPDATE reports SET payment_status = 'paid' WHERE id = p_report_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION initialize_user_trial(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_trial_plan RECORD;
BEGIN
  SELECT * INTO v_trial_plan FROM plans WHERE id = 'trial';
  
  INSERT INTO customers (id, trial_started_at, trial_ends_at, trial_credits_total, trial_credits_used, current_plan_id)
  VALUES (
    p_user_id,
    now(),
    now() + (v_trial_plan.trial_days || ' days')::INTERVAL,
    v_trial_plan.trial_credits,
    0,
    'trial'
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plans are readable by everyone" ON public.plans;
CREATE POLICY "Plans are readable by everyone" ON public.plans
  FOR SELECT USING (true);
