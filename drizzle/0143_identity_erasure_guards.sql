CREATE FUNCTION "reject_identity_erasure_receipt_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'identity erasure receipts are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "identity_erasure_receipts_immutable"
BEFORE UPDATE ON "identity_erasure_receipts"
FOR EACH ROW
EXECUTE FUNCTION "reject_identity_erasure_receipt_update"();

CREATE FUNCTION "reject_erased_identity_access_state"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialize with erasure, which locks the same user row FOR UPDATE before it
  -- removes access state and writes the receipt. If erasure is in flight this
  -- waits for its commit, then observes the receipt and rejects resurrection.
  PERFORM 1
  FROM "user"
  WHERE "id" = NEW."user_id"
  FOR KEY SHARE;

  IF EXISTS (
    SELECT 1
    FROM "identity_erasure_receipts"
    WHERE "user_id" = NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'access state cannot be created for an erased identity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "account_reject_erased_identity"
BEFORE INSERT OR UPDATE OF "user_id" ON "account"
FOR EACH ROW
EXECUTE FUNCTION "reject_erased_identity_access_state"();

CREATE TRIGGER "session_reject_erased_identity"
BEFORE INSERT OR UPDATE OF "user_id" ON "session"
FOR EACH ROW
EXECUTE FUNCTION "reject_erased_identity_access_state"();

CREATE TRIGGER "member_reject_erased_identity"
BEFORE INSERT OR UPDATE OF "user_id" ON "member"
FOR EACH ROW
EXECUTE FUNCTION "reject_erased_identity_access_state"();

CREATE TRIGGER "workspace_members_reject_erased_identity"
BEFORE INSERT OR UPDATE OF "user_id" ON "workspace_members"
FOR EACH ROW
EXECUTE FUNCTION "reject_erased_identity_access_state"();
