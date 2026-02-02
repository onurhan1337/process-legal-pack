CREATE OR REPLACE FUNCTION initialize_user_trial(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_trial_plan RECORD;
  v_existing RECORD;
BEGIN
  SELECT * INTO v_existing FROM customers WHERE id = p_user_id;
  
  IF v_existing IS NOT NULL AND v_existing.trial_started_at IS NOT NULL THEN
    RETURN;
  END IF;
  
  SELECT * INTO v_trial_plan FROM plans WHERE id = 'trial';
  
  INSERT INTO customers (id, trial_started_at, trial_ends_at, trial_usage_count, trial_usage_limit, current_plan_id)
  VALUES (
    p_user_id,
    now(),
    now() + (COALESCE(v_trial_plan.trial_days, 14) || ' days')::INTERVAL,
    0,
    COALESCE(v_trial_plan.trial_credits, 3),
    'trial'
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;
