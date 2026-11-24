#!/usr/bin/env bash
# TEMP(dev-reset): wipes everything sharing left on the DEV project: the files in R2 (shares/ and spike/), every share
# with its clips and members, every report, and the courtesies used. Accounts stay. The phones' copies are cleared
# with the Diagnóstico button in the app (do that first, so no upload is still running).
#
#   supabase/scripts/reset-sharing.sh --setup     once: creates the key, stores it on the project, deploys the function
#   supabase/scripts/reset-sharing.sh             the reset
#   supabase/scripts/reset-sharing.sh --notices   the reset, and the liability notice is asked again
#
# The key lives in supabase/.reset-key (ignored by git). Never point this at production.
set -euo pipefail

PROJECT=wkscydgikynfpfltpmht
URL="https://$PROJECT.supabase.co/functions/v1/dev-reset"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE="$HERE/.reset-key"

if [ "${1:-}" = "--setup" ]; then
  if [ ! -f "$KEY_FILE" ]; then
    (umask 077 && openssl rand -hex 24 > "$KEY_FILE")
  fi
  cd "$HERE"
  npx supabase secrets set "RESET_KEY=$(cat "$KEY_FILE")" DEV_RESET=on --project-ref "$PROJECT"
  npx supabase functions deploy dev-reset --project-ref "$PROJECT"
  echo "Pronto. Agora rode: supabase/scripts/reset-sharing.sh"
  exit 0
fi

if [ ! -f "$KEY_FILE" ]; then
  echo "Falta a chave. Rode antes: supabase/scripts/reset-sharing.sh --setup" >&2
  exit 1
fi
KEY="$(cat "$KEY_FILE")"
NOTICES=false
[ "${1:-}" = "--notices" ] && NOTICES=true

call() {
  curl -sS --fail-with-body -X POST "$URL" -H "x-reset-key: $KEY" -H 'Content-Type: application/json' -d "$1"
}

echo "R2: apagando os arquivos..."
for _ in $(seq 1 100); do
  answer="$(call '{"phase":"files"}')"
  echo "  $answer"
  left="$(printf '%s' "$answer" | sed -n 's/.*"left":\([0-9]*\).*/\1/p')"
  if [ -z "$left" ]; then
    echo "Resposta inesperada do servidor." >&2
    exit 1
  fi
  [ "$left" = "0" ] && break
done

echo "Banco: apagando links, denúncias e zerando cortesias..."
call "{\"phase\":\"db\",\"notices\":$NOTICES}"
echo
echo "Pronto."
