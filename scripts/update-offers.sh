#!/bin/bash
#
# update-offers.sh — refresh every issuer's offers.
#
# Kept as a stable entry point for existing cron jobs; the work is done by
# scripts/scrape.js, which never overwrites a data file with an empty result.
#
# Cron example (daily at 8am):
#   0 8 * * * cd /path/to/cardperks && ./scripts/update-offers.sh >> logs/scraper.log 2>&1
#

set -euo pipefail
exec node "$(dirname "$0")/scrape.js" --all "$@"
