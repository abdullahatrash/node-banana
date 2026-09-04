CREATE OR REPLACE FUNCTION "reject_workspace_product_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workspace product history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_product_record_revisions_append_only"
BEFORE UPDATE OR DELETE ON "workspace_product_record_revisions"
FOR EACH ROW EXECUTE FUNCTION "reject_workspace_product_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "workspace_product_command_receipts_append_only"
BEFORE UPDATE OR DELETE ON "workspace_product_command_receipts"
FOR EACH ROW EXECUTE FUNCTION "reject_workspace_product_history_mutation"();
