#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${APP_BASE_URL:-http://localhost:3000}"
SMOKE_EMAIL="${SMOKE_EMAIL:-alice@nodebanana.dev}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-Password123!}"
SMOKE_STORAGE_MODE="${SMOKE_STORAGE_MODE:-local}"

COOKIE_JAR="$(mktemp -t node-banana-smoke-cookies.XXXXXX)"
DEV_LOG="$(mktemp -t node-banana-smoke-devlog.XXXXXX)"
SMOKE_UPLOAD_FILE="$(mktemp -t node-banana-smoke-upload.XXXXXX).png"
DEV_PID=""

cleanup() {
  rm -f "$COOKIE_JAR"
  rm -f "$SMOKE_UPLOAD_FILE"

  if [ -n "$DEV_PID" ]; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

json_value() {
  local path="$1"

  node -e '
const fs = require("fs");
const input = fs.readFileSync(0, "utf8");
const data = JSON.parse(input);
const path = process.argv[1];

const parts = path.split(".");
let current = data;
for (const part of parts) {
  if (!part) continue;
  const match = part.match(/^([^\[]+)\[(\d+)\]$/);
  if (match) {
    const key = match[1];
    const index = Number(match[2]);
    current = current?.[key]?.[index];
  } else {
    current = current?.[part];
  }
}

if (current === undefined || current === null) {
  process.exit(2);
}

process.stdout.write(String(current));
' "$path"
}

assert_success() {
  local json="$1"
  local label="$2"

  local success
  if ! success="$(printf "%s" "$json" | json_value "success" 2>/dev/null)"; then
    echo "[FAIL] ${label}: invalid JSON response"
    echo "$json"
    exit 1
  fi

  if [ "$success" != "true" ]; then
    echo "[FAIL] ${label}: API returned success=false"
    echo "$json"
    exit 1
  fi

  echo "[OK] ${label}"
}

echo "> Infra smoke check"
echo "  Base URL: $BASE_URL"
echo "  Email: $SMOKE_EMAIL"
echo "  Storage mode: $SMOKE_STORAGE_MODE"

if ! curl -fsS "${BASE_URL}/api/auth/ok" >/dev/null 2>&1; then
  echo "[INFO] No running app detected on ${BASE_URL}; starting dev server..."
  pnpm dev >"$DEV_LOG" 2>&1 &
  DEV_PID="$!"

  for _ in $(seq 1 90); do
    if curl -fsS "${BASE_URL}/api/auth/ok" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if ! curl -fsS "${BASE_URL}/api/auth/ok" >/dev/null 2>&1; then
    echo "[FAIL] App did not become ready at ${BASE_URL}"
    echo "---- dev server logs ----"
    tail -n 100 "$DEV_LOG" || true
    exit 1
  fi
fi

echo "[OK] auth health check"

signin_payload="$(printf '{"email":"%s","password":"%s"}' "$SMOKE_EMAIL" "$SMOKE_PASSWORD")"
signin_response="$(
  curl -sS \
    -c "$COOKIE_JAR" \
    -b "$COOKIE_JAR" \
    -H "content-type: application/json" \
    -H "origin: ${BASE_URL}" \
    --data "$signin_payload" \
    "${BASE_URL}/api/auth/sign-in/email"
)"

if ! printf "%s" "$signin_response" | json_value "token" >/dev/null 2>&1; then
  echo "[FAIL] sign-in failed"
  echo "$signin_response"
  exit 1
fi
echo "[OK] sign-in with seeded user"

workspaces_response="$(
  curl -sS \
    -c "$COOKIE_JAR" \
    -b "$COOKIE_JAR" \
    "${BASE_URL}/api/studio/workspaces"
)"
assert_success "$workspaces_response" "workspace list"

workspace_id="$(printf "%s" "$workspaces_response" | json_value "workspaces[0].id")"
if [ -z "$workspace_id" ]; then
  echo "[FAIL] workspace list returned no workspace id"
  echo "$workspaces_response"
  exit 1
fi
echo "[OK] selected workspace: $workspace_id"

run_id="$(date +%s)"
asset_id=""
if [ "$SMOKE_STORAGE_MODE" = "s3" ]; then
  node -e 'require("fs").writeFileSync(process.argv[1], Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wf8MZ0AAAAASUVORK5CYII=", "base64"));' "$SMOKE_UPLOAD_FILE"
  upload_size="$(wc -c < "$SMOKE_UPLOAD_FILE" | tr -d ' ')"

  presign_payload="$(printf '{"assetType":"image","fileName":"smoke.png","contentType":"image/png","expectedSizeBytes":%s}' "$upload_size")"
  presign_response="$(
    curl -sS \
      -c "$COOKIE_JAR" \
      -b "$COOKIE_JAR" \
      -H "content-type: application/json" \
      -H "x-workspace-id: ${workspace_id}" \
      --data "$presign_payload" \
      "${BASE_URL}/api/studio/assets/presign"
  )"
  assert_success "$presign_response" "asset presign"

  asset_id="$(printf "%s" "$presign_response" | json_value "assetId")"
  upload_url="$(printf "%s" "$presign_response" | json_value "uploadUrl")"
  if [ -z "$asset_id" ] || [ -z "$upload_url" ]; then
    echo "[FAIL] presign response missing assetId/uploadUrl"
    echo "$presign_response"
    exit 1
  fi

  upload_status="$(
    curl -sS -o /dev/null -w "%{http_code}" \
      -X PUT \
      -H "Content-Type: image/png" \
      --data-binary @"$SMOKE_UPLOAD_FILE" \
      "$upload_url"
  )"
  if [ "$upload_status" != "200" ] && [ "$upload_status" != "204" ]; then
    echo "[FAIL] S3 upload failed with status ${upload_status}"
    exit 1
  fi
  echo "[OK] asset upload"

  finalize_payload="$(printf '{"uploadState":"ready","sizeBytes":%s,"mimeType":"image/png"}' "$upload_size")"
  finalize_response="$(
    curl -sS \
      -c "$COOKIE_JAR" \
      -b "$COOKIE_JAR" \
      -X PATCH \
      -H "content-type: application/json" \
      -H "x-workspace-id: ${workspace_id}" \
      --data "$finalize_payload" \
      "${BASE_URL}/api/studio/assets/${asset_id}"
  )"
  assert_success "$finalize_response" "asset finalize"
else
  asset_key="smoke/${run_id}/asset.png"
  asset_payload="$(printf '{"type":"image","storageProvider":"local","storageKey":"%s","mimeType":"image/png","metadata":{"smoke":true}}' "$asset_key")"

  asset_create_response="$(
    curl -sS \
      -c "$COOKIE_JAR" \
      -b "$COOKIE_JAR" \
      -H "content-type: application/json" \
      -H "x-workspace-id: ${workspace_id}" \
      --data "$asset_payload" \
      "${BASE_URL}/api/studio/assets"
  )"
  assert_success "$asset_create_response" "asset create"

  asset_id="$(printf "%s" "$asset_create_response" | json_value "asset.id")"
  if [ -z "$asset_id" ]; then
    echo "[FAIL] asset create returned no asset id"
    echo "$asset_create_response"
    exit 1
  fi
fi

asset_list_response="$(
  curl -sS \
    -c "$COOKIE_JAR" \
    -b "$COOKIE_JAR" \
    -H "x-workspace-id: ${workspace_id}" \
    "${BASE_URL}/api/studio/assets"
)"
assert_success "$asset_list_response" "asset list"

asset_delete_response="$(
  curl -sS \
    -c "$COOKIE_JAR" \
    -b "$COOKIE_JAR" \
    -X DELETE \
    -H "x-workspace-id: ${workspace_id}" \
    "${BASE_URL}/api/studio/assets/${asset_id}"
)"
assert_success "$asset_delete_response" "asset delete (soft)"

echo "[OK] Infra smoke passed: auth, workspaces, workspace media lifecycle"
