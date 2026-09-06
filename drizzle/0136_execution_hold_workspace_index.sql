CREATE INDEX "merchant_execution_holds_workspace_idx" ON "merchant_execution_holds" USING btree ("workspace_id", "state", "updated_at");
