#!/usr/bin/env bash
#
# Proves a deployment actually works, from outside it.
#
#   deploy/scripts/smoke-test.sh https://hadiya.example.com
#   SMOKE_USER=owner SMOKE_PASSWORD='…' deploy/scripts/smoke-test.sh https://hadiya.example.com
#
# Read-only and non-destructive by construction: it signs in, reads, opens a
# stream and signs out. It creates one conversation — the only way to prove the
# assistant path works at all — and nothing else. It never writes to Billz,
# never runs a destructive tool, and never confirms a pending action.
#
# Without credentials it runs the anonymous checks only, which is still worth
# doing: health, the frontend, and the fact that protected routes refuse.
set -uo pipefail

BASE="${1:-}"
[[ -z "${BASE}" ]] && { echo "Usage: smoke-test.sh <base-url>" >&2; exit 1; }
BASE="${BASE%/}"

USER="${SMOKE_USER:-}"
PASSWORD="${SMOKE_PASSWORD:-}"

PASSED=0
FAILED=0
SKIPPED=0

ok()   { echo "  PASS  $*"; PASSED=$((PASSED + 1)); }
bad()  { echo "  FAIL  $*"; FAILED=$((FAILED + 1)); }
skip() { echo "  SKIP  $*"; SKIPPED=$((SKIPPED + 1)); }

status() { curl -s -o /dev/null -w '%{http_code}' -m 15 "$@"; }

echo
echo "Smoke test against ${BASE}"
echo

# --- 1. Health --------------------------------------------------------------
[[ "$(status "${BASE}/api/health/live")" == "200" ]] \
  && ok "liveness" || bad "liveness did not answer 200"

READY="$(curl -s -m 15 "${BASE}/api/health/ready")"
if echo "${READY}" | grep -q '"status":"ok"'; then
  ok "readiness, with every dependency up"
else
  bad "readiness reported a problem: $(echo "${READY}" | head -c 200)"
fi

# --- 2. Transport -----------------------------------------------------------
if [[ "${BASE}" == https://* ]]; then
  HTTP_BASE="http://${BASE#https://}"
  REDIRECT="$(curl -s -o /dev/null -w '%{http_code}' -m 15 "${HTTP_BASE}/api/health/live")"
  [[ "${REDIRECT}" == "301" || "${REDIRECT}" == "308" ]] \
    && ok "plain HTTP redirects to HTTPS (${REDIRECT})" \
    || bad "plain HTTP answered ${REDIRECT} rather than redirecting"

  curl -s -D - -o /dev/null -m 15 "${BASE}/api/health/live" | grep -qi 'strict-transport-security' \
    && ok "HSTS is set" || bad "no Strict-Transport-Security header"
else
  skip "transport checks (the base URL is not https)"
fi

# --- 3. Frontend ------------------------------------------------------------
HTML="$(curl -s -m 15 "${BASE}/")"
echo "${HTML}" | grep -qi '<div id="app"' && ok "the frontend is served" || bad "the frontend did not return the app shell"

# A client-side route must return the shell rather than a 404, or a reload on
# any page but the root breaks.
[[ "$(status "${BASE}/reminders")" == "200" ]] \
  && ok "SPA routing (a deep link returns the app)" \
  || bad "a deep link did not return the app; check try_files in Nginx"

# --- 4. Authentication is actually required ---------------------------------
[[ "$(status "${BASE}/api/v1/conversations")" == "401" ]] \
  && ok "protected routes refuse an anonymous request" \
  || bad "a protected route did not answer 401"

# --- 5. Everything below needs credentials ----------------------------------
if [[ -z "${USER}" || -z "${PASSWORD}" ]]; then
  echo
  skip "sign-in, conversation, streaming, analytics and sign-out"
  echo "       Set SMOKE_USER and SMOKE_PASSWORD to run the whole test."
else
  LOGIN="$(curl -s -m 15 -X POST "${BASE}/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"username\":\"${USER}\",\"password\":\"${PASSWORD}\"}")"
  TOKEN="$(echo "${LOGIN}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"

  if [[ -z "${TOKEN}" ]]; then
    bad "sign-in failed"
  else
    ok "sign-in"
    AUTH=(-H "authorization: Bearer ${TOKEN}")

    curl -s -m 15 "${AUTH[@]}" "${BASE}/api/v1/auth/me" | grep -q '"username"' \
      && ok "the session identifies the user" || bad "/auth/me did not return the account"

    # A conversation, which is the only write this test performs.
    CONV="$(curl -s -m 15 "${AUTH[@]}" -X POST "${BASE}/api/v1/conversations" \
      -H 'content-type: application/json' -d '{"title":"Smoke test"}')"
    CONV_ID="$(echo "${CONV}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
    [[ -n "${CONV_ID}" ]] && ok "a conversation can be created" || bad "could not create a conversation"

    # The assistant. A 503 here is a configured-but-unavailable model, which is
    # a real answer and not a broken deployment, so it is reported as such.
    AI="$(curl -s -m 15 "${AUTH[@]}" "${BASE}/api/v1/ai/status")"
    if echo "${AI}" | grep -q '"available":true'; then
      ok "a model provider is configured"

      # Streaming, through whatever proxy is in front. The test is that the
      # first frame arrives promptly: a proxy buffering the response would
      # deliver nothing until the turn ended.
      STREAM="$(curl -s -N -m 25 "${AUTH[@]}" -X POST "${BASE}/api/v1/ai/chat?stream=1" \
        -H 'content-type: application/json' -H 'accept: text/event-stream' \
        -d '{"message":"Salom"}' | head -c 400)"

      echo "${STREAM}" | grep -q 'event: ' \
        && ok "the answer streams through the proxy" \
        || bad "no stream frames arrived; check proxy_buffering for the SSE route"
    else
      skip "the assistant (no model provider configured; /ai/chat will answer 503)"
    fi

    # Billz, read-only. Unconfigured is a legitimate state.
    BILLZ="$(status "${AUTH[@]}" "${BASE}/api/v1/integrations/billz/capabilities")"
    case "${BILLZ}" in
      200) ok "Billz answers a read-only request" ;;
      503) skip "Billz (not configured on this deployment)" ;;
      *)   bad "Billz answered ${BILLZ}" ;;
    esac

    for path in notifications/unread-count reminders files memory; do
      [[ "$(status "${AUTH[@]}" "${BASE}/api/v1/${path}")" == "200" ]] \
        && ok "${path} reads" || bad "${path} did not answer 200"
    done

    [[ "$(status "${AUTH[@]}" -X POST "${BASE}/api/v1/auth/logout")" == "204" ]] \
      && ok "sign-out" || bad "sign-out did not answer 204"
  fi
fi

echo
echo "  ${PASSED} passed, ${FAILED} failed, ${SKIPPED} skipped."
echo

[[ "${FAILED}" -gt 0 ]] && exit 1
exit 0
