#!/bin/sh
set -e

# Fail fast if webhook secret is not configured
if [ -z "$BRIDGE_WEBHOOK_SECRET" ]; then
  echo "FATAL: BRIDGE_WEBHOOK_SECRET is not set. Mox cannot forward emails to the bridge without it." >&2
  exit 1
fi

# sed is used because envsubst/gettext is NOT installed in the Mox Alpine image
sed "s|\${BRIDGE_WEBHOOK_SECRET}|${BRIDGE_WEBHOOK_SECRET}|g" \
  /mox/config/domains.conf.template > /mox/config/domains.conf
exec mox serve
