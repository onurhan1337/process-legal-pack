UPDATE public.plans SET
  price_monthly = 9900,
  reports_per_month = 100,
  features = '["100 legal pack analyses per month", "AI-powered document review", "Risk assessment scoring", "Document chat assistant", "Email support"]'
WHERE id = 'starter';

UPDATE public.plans SET
  price_monthly = 24900,
  reports_per_month = 300,
  features = '["300 legal pack analyses per month", "Everything in Starter", "Priority support", "Advanced analytics", "Bulk upload support"]'
WHERE id = 'professional';

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS usage_limit INTEGER;

CREATE TABLE IF NOT EXISTS public.usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  billing_period_start TIMESTAMPTZ NOT NULL,
  billing_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_period ON usage_records(user_id, billing_period_start, billing_period_end);

ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage records" ON public.usage_records;
CREATE POLICY "Users can view own usage records" ON public.usage_records
  FOR SELECT USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION check_user_access(p_user_id UUID)
RETURNS TABLE (
  has_access BOOLEAN,
  is_trial BOOLEAN,
  is_unlimited BOOLEAN,
  credits_remaining INTEGER,
  plan_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  usage_count INTEGER,
  usage_limit INTEGER,
  period_ends_at TIMESTAMPTZ
) AS $$
DECLARE
  v_customer RECORD;
  v_subscription RECORD;
  v_plan RECORD;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_user_id;
  
  SELECT s.*, p.reports_per_month 
  INTO v_subscription 
  FROM subscriptions s
  LEFT JOIN plans p ON s.plan_id = p.id
  WHERE s.user_id = p_user_id AND s.status IN ('active', 'trialing')
  ORDER BY s.created_at DESC LIMIT 1;
  
  IF v_subscription IS NOT NULL THEN
    DECLARE
      v_usage_limit INTEGER;
      v_usage_remaining INTEGER;
      v_is_unlimited BOOLEAN;
    BEGIN
      IF v_subscription.usage_limit IS NOT NULL THEN
        v_usage_limit := v_subscription.usage_limit;
      ELSIF v_subscription.reports_per_month IS NOT NULL AND v_subscription.reports_per_month > 0 THEN
        v_usage_limit := v_subscription.reports_per_month;
      ELSE
        v_usage_limit := -1;
      END IF;
      
      v_is_unlimited := v_usage_limit = -1;
      
      IF v_is_unlimited THEN
        v_usage_remaining := -1;
      ELSE
        v_usage_remaining := GREATEST(0, v_usage_limit - COALESCE(v_subscription.usage_count, 0));
      END IF;
      
      RETURN QUERY SELECT 
        v_is_unlimited OR v_usage_remaining > 0,
        false,
        v_is_unlimited,
        v_usage_remaining,
        v_subscription.plan_id,
        NULL::TIMESTAMPTZ,
        COALESCE(v_subscription.usage_count, 0),
        v_usage_limit,
        v_subscription.current_period_end::TIMESTAMPTZ;
      RETURN;
    END;
  END IF;
  
  IF v_customer IS NOT NULL AND v_customer.trial_ends_at > now() THEN
    RETURN QUERY SELECT 
      (v_customer.trial_credits_total - v_customer.trial_credits_used) > 0,
      true,
      false,
      v_customer.trial_credits_total - v_customer.trial_credits_used,
      'trial'::TEXT,
      v_customer.trial_ends_at,
      v_customer.trial_credits_used,
      v_customer.trial_credits_total,
      v_customer.trial_ends_at;
    RETURN;
  END IF;
  
  RETURN QUERY SELECT 
    false, false, false, 0, 'expired'::TEXT, 
    v_customer.trial_ends_at, 0, 0, NULL::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION consume_usage(p_user_id UUID, p_report_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_sub RECORD;
  v_usage_limit INTEGER;
BEGIN
  SELECT s.*, p.reports_per_month 
  INTO v_sub
  FROM subscriptions s
  LEFT JOIN plans p ON s.plan_id = p.id
  WHERE s.user_id = p_user_id AND s.status = 'active'
  FOR UPDATE OF s;
  
  IF v_sub IS NULL THEN
    RETURN FALSE;
  END IF;
  
  IF v_sub.usage_limit IS NOT NULL THEN
    v_usage_limit := v_sub.usage_limit;
  ELSIF v_sub.reports_per_month IS NOT NULL AND v_sub.reports_per_month > 0 THEN
    v_usage_limit := v_sub.reports_per_month;
  ELSE
    UPDATE reports SET payment_status = 'paid' WHERE id = p_report_id;
    RETURN TRUE;
  END IF;
  
  IF COALESCE(v_sub.usage_count, 0) >= v_usage_limit THEN
    RETURN FALSE;
  END IF;
  
  UPDATE subscriptions 
  SET usage_count = COALESCE(usage_count, 0) + 1,
      updated_at = now()
  WHERE id = v_sub.id;
  
  INSERT INTO usage_records (
    user_id, 
    subscription_id, 
    report_id, 
    billing_period_start, 
    billing_period_end
  ) VALUES (
    p_user_id,
    v_sub.id,
    p_report_id,
    v_sub.current_period_start,
    v_sub.current_period_end
  );
  
  UPDATE reports SET payment_status = 'paid' WHERE id = p_report_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reset_subscription_usage(
  p_stripe_subscription_id TEXT, 
  p_period_start TIMESTAMPTZ, 
  p_period_end TIMESTAMPTZ
)
RETURNS VOID AS $$
BEGIN
  UPDATE subscriptions
  SET usage_count = 0,
      current_period_start = p_period_start,
      current_period_end = p_period_end,
      updated_at = now()
  WHERE stripe_subscription_id = p_stripe_subscription_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION initialize_subscription_usage(
  p_user_id UUID,
  p_stripe_subscription_id TEXT,
  p_plan_id TEXT,
  p_usage_limit INTEGER,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ
)
RETURNS VOID AS $$
BEGIN
  UPDATE subscriptions
  SET usage_count = 0,
      usage_limit = p_usage_limit,
      plan_id = p_plan_id,
      current_period_start = p_period_start,
      current_period_end = p_period_end,
      updated_at = now()
  WHERE stripe_subscription_id = p_stripe_subscription_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
