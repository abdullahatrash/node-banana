INSERT INTO "billing_plan_versions" (
  "plan_id", "version", "status", "authored_name", "currency", "price_minor",
  "billing_interval", "tax_mode", "trial_days", "trial_credit_units", "entitlements",
  "terms_digest", "effective_at"
) VALUES
  ('free', 1, 'active', '{"ar":"مجانية","en":"Free"}'::jsonb, 'USD', 0, 'month', 'inclusive', 0, 0,
    '{"generationCreditsPerPeriod":10,"workspaceSeats":1,"connectedChannels":2,"activeAutomations":0,"apiAccess":false,"creatorPersonas":false,"managedChannelOnboarding":false}'::jsonb,
    'sha256:e7982e9ac70a65497ce186e5a4dd12a10420ed28c5aa04d5fb4b2755b9f52b16', '2026-09-01T00:00:00.000Z'::timestamptz),
  ('starter', 1, 'active', '{"ar":"البداية","en":"Starter"}'::jsonb, 'USD', 2900, 'month', 'inclusive', 7, 25,
    '{"generationCreditsPerPeriod":250,"workspaceSeats":3,"connectedChannels":5,"activeAutomations":3,"apiAccess":false,"creatorPersonas":false,"managedChannelOnboarding":false}'::jsonb,
    'sha256:1dfd198acc1a6579eab3b1a90aeb883ba61cd45aea5ed8f238c4f5fe3abf7d1f', '2026-09-01T00:00:00.000Z'::timestamptz),
  ('growth', 1, 'active', '{"ar":"النمو","en":"Growth"}'::jsonb, 'USD', 4900, 'month', 'inclusive', 7, 50,
    '{"generationCreditsPerPeriod":500,"workspaceSeats":10,"connectedChannels":15,"activeAutomations":15,"apiAccess":true,"creatorPersonas":true,"managedChannelOnboarding":true}'::jsonb,
    'sha256:890649c8045a5e5049009014ca24bcb56a89fcfa6f7faae5af61a8800460a46b', '2026-09-01T00:00:00.000Z'::timestamptz),
  ('pro', 1, 'active', '{"ar":"الاحترافية","en":"Pro"}'::jsonb, 'USD', 14900, 'month', 'inclusive', 7, 100,
    '{"generationCreditsPerPeriod":2000,"workspaceSeats":25,"connectedChannels":50,"activeAutomations":50,"apiAccess":true,"creatorPersonas":true,"managedChannelOnboarding":true}'::jsonb,
    'sha256:a4c65270297f9186fde68d39da79b101bffaa1e4e0be53b7228cd89445907e60', '2026-09-01T00:00:00.000Z'::timestamptz)
ON CONFLICT ("plan_id", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "generation_credit_pack_versions" (
  "pack_id", "version", "status", "authored_name", "credit_units", "price_minor",
  "tax_minor", "currency", "terms_digest", "effective_at"
) VALUES
  ('boost-100', 1, 'active', '{"ar":"دفعة 100","en":"Boost 100"}'::jsonb, 100, 1200, 0, 'USD',
    'sha256:f17f69c0b8da87b042c56cf28652661d5eddbde0a13b0c896b2dd53f8be7a151', '2026-09-01T00:00:00.000Z'::timestamptz),
  ('scale-500', 1, 'active', '{"ar":"دفعة 500","en":"Scale 500"}'::jsonb, 500, 3900, 0, 'USD',
    'sha256:4a0d5ac2668760a1906e333230303345b3d071712e5e5d02f8c1302effb78428', '2026-09-01T00:00:00.000Z'::timestamptz),
  ('studio-1200', 1, 'active', '{"ar":"دفعة الاستوديو 1200","en":"Studio 1200"}'::jsonb, 1200, 7900, 0, 'USD',
    'sha256:414d83e407bdf41e7e459be7323af055d2ebb4df38b8e1993edc10a4d78c7eac', '2026-09-01T00:00:00.000Z'::timestamptz)
ON CONFLICT ("pack_id", "version") DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "billing_plan_versions"
    WHERE "version" = 1
      AND (
        ("plan_id" = 'free' AND "status" = 'active' AND "authored_name" = '{"ar":"مجانية","en":"Free"}'::jsonb AND "currency" = 'USD' AND "price_minor" = 0 AND "billing_interval" = 'month' AND "tax_mode" = 'inclusive' AND "trial_days" = 0 AND "trial_credit_units" = 0 AND "entitlements" = '{"generationCreditsPerPeriod":10,"workspaceSeats":1,"connectedChannels":2,"activeAutomations":0,"apiAccess":false,"creatorPersonas":false,"managedChannelOnboarding":false}'::jsonb AND "terms_digest" = 'sha256:e7982e9ac70a65497ce186e5a4dd12a10420ed28c5aa04d5fb4b2755b9f52b16' AND "effective_at" = '2026-09-01T00:00:00.000Z'::timestamptz AND "retired_at" IS NULL) OR
        ("plan_id" = 'starter' AND "status" = 'active' AND "authored_name" = '{"ar":"البداية","en":"Starter"}'::jsonb AND "currency" = 'USD' AND "price_minor" = 2900 AND "billing_interval" = 'month' AND "tax_mode" = 'inclusive' AND "trial_days" = 7 AND "trial_credit_units" = 25 AND "entitlements" = '{"generationCreditsPerPeriod":250,"workspaceSeats":3,"connectedChannels":5,"activeAutomations":3,"apiAccess":false,"creatorPersonas":false,"managedChannelOnboarding":false}'::jsonb AND "terms_digest" = 'sha256:1dfd198acc1a6579eab3b1a90aeb883ba61cd45aea5ed8f238c4f5fe3abf7d1f' AND "effective_at" = '2026-09-01T00:00:00.000Z'::timestamptz AND "retired_at" IS NULL) OR
        ("plan_id" = 'growth' AND "status" = 'active' AND "authored_name" = '{"ar":"النمو","en":"Growth"}'::jsonb AND "currency" = 'USD' AND "price_minor" = 4900 AND "billing_interval" = 'month' AND "tax_mode" = 'inclusive' AND "trial_days" = 7 AND "trial_credit_units" = 50 AND "entitlements" = '{"generationCreditsPerPeriod":500,"workspaceSeats":10,"connectedChannels":15,"activeAutomations":15,"apiAccess":true,"creatorPersonas":true,"managedChannelOnboarding":true}'::jsonb AND "terms_digest" = 'sha256:890649c8045a5e5049009014ca24bcb56a89fcfa6f7faae5af61a8800460a46b' AND "effective_at" = '2026-09-01T00:00:00.000Z'::timestamptz AND "retired_at" IS NULL) OR
        ("plan_id" = 'pro' AND "status" = 'active' AND "authored_name" = '{"ar":"الاحترافية","en":"Pro"}'::jsonb AND "currency" = 'USD' AND "price_minor" = 14900 AND "billing_interval" = 'month' AND "tax_mode" = 'inclusive' AND "trial_days" = 7 AND "trial_credit_units" = 100 AND "entitlements" = '{"generationCreditsPerPeriod":2000,"workspaceSeats":25,"connectedChannels":50,"activeAutomations":50,"apiAccess":true,"creatorPersonas":true,"managedChannelOnboarding":true}'::jsonb AND "terms_digest" = 'sha256:a4c65270297f9186fde68d39da79b101bffaa1e4e0be53b7228cd89445907e60' AND "effective_at" = '2026-09-01T00:00:00.000Z'::timestamptz AND "retired_at" IS NULL)
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'default billing plan v1 catalog conflicts with an existing immutable version';
  END IF;

  IF (
    SELECT count(*)
    FROM "generation_credit_pack_versions"
    WHERE "version" = 1
      AND (
        ("pack_id" = 'boost-100' AND "status" = 'active' AND "authored_name" = '{"ar":"دفعة 100","en":"Boost 100"}'::jsonb AND "credit_units" = 100 AND "price_minor" = 1200 AND "tax_minor" = 0 AND "currency" = 'USD' AND "terms_digest" = 'sha256:f17f69c0b8da87b042c56cf28652661d5eddbde0a13b0c896b2dd53f8be7a151' AND "effective_at" = '2026-09-01T00:00:00.000Z'::timestamptz AND "retired_at" IS NULL) OR
        ("pack_id" = 'scale-500' AND "status" = 'active' AND "authored_name" = '{"ar":"دفعة 500","en":"Scale 500"}'::jsonb AND "credit_units" = 500 AND "price_minor" = 3900 AND "tax_minor" = 0 AND "currency" = 'USD' AND "terms_digest" = 'sha256:4a0d5ac2668760a1906e333230303345b3d071712e5e5d02f8c1302effb78428' AND "effective_at" = '2026-09-01T00:00:00.000Z'::timestamptz AND "retired_at" IS NULL) OR
        ("pack_id" = 'studio-1200' AND "status" = 'active' AND "authored_name" = '{"ar":"دفعة الاستوديو 1200","en":"Studio 1200"}'::jsonb AND "credit_units" = 1200 AND "price_minor" = 7900 AND "tax_minor" = 0 AND "currency" = 'USD' AND "terms_digest" = 'sha256:414d83e407bdf41e7e459be7323af055d2ebb4df38b8e1993edc10a4d78c7eac' AND "effective_at" = '2026-09-01T00:00:00.000Z'::timestamptz AND "retired_at" IS NULL)
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'default Generation Credit pack v1 catalog conflicts with an existing immutable version';
  END IF;
END $$;
