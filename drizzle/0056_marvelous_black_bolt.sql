ALTER TABLE "brand_profiles" ALTER COLUMN "generated_from_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "source_profile_id" text;--> statement-breakpoint
CREATE INDEX "brand_profiles_source_profile_idx" ON "brand_profiles" USING btree ("source_profile_id");