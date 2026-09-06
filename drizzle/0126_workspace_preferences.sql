ALTER TABLE "workspace_settings"
  ADD COLUMN "content_market" text DEFAULT 'SA' NOT NULL;

ALTER TABLE "workspace_settings"
  ADD CONSTRAINT "workspace_settings_content_market_check"
  CHECK ("content_market" IN ('SA', 'AE', 'EG', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'MA', 'DZ', 'TN', 'LY', 'YE', 'PS', 'SD', 'SY'));
