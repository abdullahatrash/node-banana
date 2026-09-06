CREATE OR REPLACE FUNCTION public.enforce_workspace_seat_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_limit integer := 1;
  v_entitlements jsonb;
  v_active_members integer;
BEGIN
  PERFORM 1
  FROM public."workspaces"
  WHERE "id" = NEW."workspace_id"
    AND "deleted_at" IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND';
  END IF;

  -- Preserve idempotent INSERT ... ON CONFLICT membership projections. The
  -- existing row does not consume another seat and the constraint remains the
  -- authority for whether the statement updates or does nothing.
  IF EXISTS (
    SELECT 1
    FROM public."workspace_members"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "user_id" = NEW."user_id"
  ) THEN
    RETURN NEW;
  END IF;

  SELECT p."entitlements"
  INTO v_entitlements
  FROM public."workspace_subscriptions" AS s
  JOIN public."billing_plan_versions" AS p
    ON p."plan_id" = s."plan_id"
   AND p."version" = s."plan_version"
  WHERE s."workspace_id" = NEW."workspace_id"
    AND (
      (s."state" IN ('trialing', 'active', 'cancel_at_period_end')
        AND s."current_period_ends_at" > clock_timestamp())
      OR (s."state" = 'grace'
        AND s."grace_ends_at" > clock_timestamp())
    );

  IF FOUND THEN
    IF jsonb_typeof(v_entitlements -> 'workspaceSeats') <> 'number'
      OR (v_entitlements ->> 'workspaceSeats') !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION 'PLAN_ENTITLEMENTS_INVALID';
    END IF;
    v_limit := (v_entitlements ->> 'workspaceSeats')::integer;
  END IF;

  SELECT count(*)::integer
  INTO v_active_members
  FROM public."workspace_members"
  WHERE "workspace_id" = NEW."workspace_id";

  IF v_active_members >= v_limit THEN
    RAISE EXCEPTION 'PLAN_WORKSPACE_SEAT_LIMIT_REACHED';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_members_seat_entitlement_guard ON public."workspace_members";
--> statement-breakpoint
CREATE TRIGGER workspace_members_seat_entitlement_guard
BEFORE INSERT ON public."workspace_members"
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_seat_entitlement();
