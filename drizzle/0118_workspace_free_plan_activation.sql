CREATE OR REPLACE FUNCTION public.ensure_workspace_free_plan_v1(
  p_workspace_id text,
  p_now timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_workspace_id text;
  v_plan public.billing_plan_versions%ROWTYPE;
  v_subscription public.workspace_subscriptions%ROWTYPE;
  v_bucket public.generation_credit_buckets%ROWTYPE;
  v_ledger public.generation_credit_ledger_entries%ROWTYPE;
  v_ledger_count integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_revision integer;
  v_bucket_id text;
  v_source_ref text;
  v_sequence integer;
  v_action text := 'existing';
BEGIN
  IF p_workspace_id IS NULL OR btrim(p_workspace_id) = '' OR p_now IS NULL THEN
    RAISE EXCEPTION 'FREE_PLAN_ACTIVATION_INPUT_INVALID';
  END IF;

  SELECT w."id"
  INTO v_workspace_id
  FROM public."workspaces" AS w
  WHERE w."id" = p_workspace_id
    AND w."deleted_at" IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'ineligible';
  END IF;

  SELECT p.*
  INTO v_plan
  FROM public."billing_plan_versions" AS p
  WHERE p."plan_id" = 'free'
    AND p."version" = 1
  FOR SHARE;

  IF NOT FOUND
    OR v_plan."status" <> 'active'
    OR v_plan."currency" <> 'USD'
    OR v_plan."price_minor" <> 0
    OR v_plan."billing_interval" <> 'month'
    OR v_plan."trial_days" <> 0
    OR v_plan."trial_credit_units" <> 0
    OR (v_plan."entitlements" ->> 'generationCreditsPerPeriod') IS DISTINCT FROM '10'
    OR v_plan."terms_digest" <> 'sha256:e7982e9ac70a65497ce186e5a4dd12a10420ed28c5aa04d5fb4b2755b9f52b16'
    OR v_plan."effective_at" > p_now
    OR (v_plan."retired_at" IS NOT NULL AND v_plan."retired_at" <= p_now)
  THEN
    RAISE EXCEPTION 'FREE_PLAN_V1_CATALOG_INVALID';
  END IF;

  SELECT s.*
  INTO v_subscription
  FROM public."workspace_subscriptions" AS s
  WHERE s."workspace_id" = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_period_start := p_now;
    v_period_end := p_now + interval '1 month';
    v_revision := 1;
    v_action := 'activated';

    INSERT INTO public."workspace_subscriptions" (
      "workspace_id", "state", "plan_id", "plan_version", "trial_grant_id",
      "merchant_customer_ref", "merchant_subscription_ref",
      "current_period_starts_at", "current_period_ends_at", "grace_ends_at",
      "revision", "updated_at"
    ) VALUES (
      p_workspace_id, 'active', 'free', 1, NULL, NULL, NULL,
      v_period_start, v_period_end, NULL, v_revision, p_now
    )
    RETURNING * INTO v_subscription;
  ELSIF v_subscription."plan_id" <> 'free'
    OR v_subscription."plan_version" <> 1
    OR v_subscription."state" <> 'active'
  THEN
    RETURN 'existing_non_free';
  ELSIF v_subscription."current_period_ends_at" <= p_now THEN
    v_period_start := p_now;
    v_period_end := p_now + interval '1 month';
    v_revision := v_subscription."revision" + 1;
    v_action := 'renewed';

    UPDATE public."workspace_subscriptions"
    SET "current_period_starts_at" = v_period_start,
        "current_period_ends_at" = v_period_end,
        "grace_ends_at" = NULL,
        "revision" = v_revision,
        "updated_at" = p_now
    WHERE "workspace_id" = p_workspace_id
      AND "revision" = v_subscription."revision"
    RETURNING * INTO v_subscription;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'FREE_PLAN_SUBSCRIPTION_REVISION_CONFLICT';
    END IF;
  ELSE
    v_period_start := v_subscription."current_period_starts_at";
    v_period_end := v_subscription."current_period_ends_at";
    v_revision := v_subscription."revision";
  END IF;

  IF v_action IN ('activated', 'renewed') THEN
    INSERT INTO public."workspace_subscription_events" (
      "workspace_id", "revision", "id", "from_state", "to_state",
      "reason_code", "actor_ref", "facts", "occurred_at"
    ) VALUES (
      p_workspace_id,
      v_revision,
      'free_subscription_event:v1:' || p_workspace_id || ':' || v_revision::text,
      CASE WHEN v_action = 'activated' THEN NULL ELSE 'active' END,
      'active',
      CASE WHEN v_action = 'activated' THEN 'plan.free.activated' ELSE 'plan.free.renewed' END,
      'system:commercial-free-plan',
      jsonb_build_object(
        'planId', 'free',
        'planVersion', 1,
        'creditUnits', 10,
        'periodStartsAt', v_period_start,
        'periodEndsAt', v_period_end
      ),
      p_now
    );
  END IF;

  v_bucket_id := 'free_allowance:v1:' || p_workspace_id || ':' || v_revision::text;
  v_source_ref := 'plan:free:1:subscription-revision:' || v_revision::text;

  SELECT b.*
  INTO v_bucket
  FROM public."generation_credit_buckets" AS b
  WHERE b."workspace_id" = p_workspace_id
    AND b."kind" = 'allowance'
    AND b."source_ref" = v_source_ref
  FOR UPDATE;

  IF FOUND THEN
    IF v_bucket."id" <> v_bucket_id
      OR v_bucket."granted_units" <> 10
      OR v_bucket."expires_at" IS DISTINCT FROM v_period_end
    THEN
      RAISE EXCEPTION 'FREE_PLAN_ALLOWANCE_CONFLICT';
    END IF;
  ELSE
    INSERT INTO public."generation_credit_buckets" (
      "workspace_id", "id", "kind", "source_ref", "granted_units",
      "available_units", "expires_at", "revision", "created_at", "updated_at"
    ) VALUES (
      p_workspace_id, v_bucket_id, 'allowance', v_source_ref, 10,
      10, v_period_end, 1, p_now, p_now
    )
    RETURNING * INTO v_bucket;
  END IF;

  SELECT count(*)
  INTO v_ledger_count
  FROM public."generation_credit_ledger_entries" AS l
  WHERE l."workspace_id" = p_workspace_id
    AND l."bucket_id" = v_bucket_id
    AND l."entry_type" = 'grant'
    AND l."source_ref" = v_source_ref;

  IF v_ledger_count > 1 THEN
    RAISE EXCEPTION 'FREE_PLAN_LEDGER_CONFLICT';
  ELSIF v_ledger_count = 1 THEN
    SELECT l.*
    INTO STRICT v_ledger
    FROM public."generation_credit_ledger_entries" AS l
    WHERE l."workspace_id" = p_workspace_id
      AND l."bucket_id" = v_bucket_id
      AND l."entry_type" = 'grant'
      AND l."source_ref" = v_source_ref;

    IF v_ledger."delta_units" <> 10 OR v_ledger."balance_after_units" <> 10 THEN
      RAISE EXCEPTION 'FREE_PLAN_LEDGER_CONFLICT';
    END IF;
  ELSE
    IF v_bucket."available_units" <> 10 OR v_bucket."revision" <> 1 THEN
      RAISE EXCEPTION 'FREE_PLAN_LEDGER_CONFLICT';
    END IF;

    SELECT coalesce(max(l."sequence"), 0) + 1
    INTO v_sequence
    FROM public."generation_credit_ledger_entries" AS l
    WHERE l."workspace_id" = p_workspace_id;

    INSERT INTO public."generation_credit_ledger_entries" (
      "workspace_id", "sequence", "id", "bucket_id", "reservation_id",
      "entry_type", "delta_units", "balance_after_units", "source_ref", "created_at"
    ) VALUES (
      p_workspace_id,
      v_sequence,
      'free_grant:v1:' || p_workspace_id || ':' || v_revision::text,
      v_bucket_id,
      NULL,
      'grant',
      10,
      10,
      v_source_ref,
      p_now
    );
  END IF;

  RETURN v_action;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  v_workspace record;
BEGIN
  FOR v_workspace IN
    SELECT w."id"
    FROM public."workspaces" AS w
    WHERE w."deleted_at" IS NULL
    ORDER BY w."id"
  LOOP
    PERFORM public.ensure_workspace_free_plan_v1(v_workspace."id", clock_timestamp());
  END LOOP;
END;
$$;
