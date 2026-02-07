#!/bin/bash
#
# update-offers.sh — Run all scrapers and log output
#
# Usage:
#   ./scripts/update-offers.sh
#
# Cron example (daily at 8am):
#   0 8 * * * cd /path/to/deel && ./scripts/update-offers.sh >> logs/scraper.log 2>&1
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"

mkdir -p "$LOG_DIR"

echo "========================================"
echo "CardPerks Offer Update — $(date)"
echo "========================================"

# Back up current data
if [ -d "$PROJECT_DIR/data" ]; then
  cp -r "$PROJECT_DIR/data" "$PROJECT_DIR/data.bak"
  echo "Backed up data/ to data.bak/"
fi

# Run Amex scraper
echo ""
echo "--- Amex Scraper ---"
if node "$SCRIPT_DIR/scrape-amex.js" 2>&1; then
  echo "Amex scraper completed successfully"
else
  echo "WARNING: Amex scraper failed, restoring backup"
  if [ -d "$PROJECT_DIR/data.bak" ]; then
    cp "$PROJECT_DIR/data.bak/amex-offers.json" "$PROJECT_DIR/data/amex-offers.json" 2>/dev/null || true
  fi
fi

# Run Chase scraper
echo ""
echo "--- Chase Scraper ---"
if node "$SCRIPT_DIR/scrape-chase.js" 2>&1; then
  echo "Chase scraper completed successfully"
else
  echo "WARNING: Chase scraper failed, restoring backup"
  if [ -d "$PROJECT_DIR/data.bak" ]; then
    cp "$PROJECT_DIR/data.bak/chase-offers.json" "$PROJECT_DIR/data/chase-offers.json" 2>/dev/null || true
  fi
fi

# Run BofA scraper
echo ""
echo "--- BofA Scraper ---"
if node "$SCRIPT_DIR/scrape-bofa.js" 2>&1; then
  echo "BofA scraper completed successfully"
else
  echo "WARNING: BofA scraper failed, restoring backup"
  if [ -d "$PROJECT_DIR/data.bak" ]; then
    cp "$PROJECT_DIR/data.bak/bofa-offers.json" "$PROJECT_DIR/data/bofa-offers.json" 2>/dev/null || true
  fi
fi

# Add future scrapers here:
# echo ""
# echo "--- Capital One Scraper ---"
# node "$SCRIPT_DIR/scrape-capone.js" 2>&1 || echo "WARNING: Capital One scraper failed"

# Clean up backup
rm -rf "$PROJECT_DIR/data.bak"

# Validate JSON files
echo ""
echo "--- Validating JSON ---"
VALID=true
for f in "$PROJECT_DIR/data"/*.json; do
  if python3 -c "import json; json.load(open('$f'))" 2>/dev/null; then
    COUNT=$(python3 -c "import json; d=json.load(open('$f')); print(len(d.get('offers',[])))")
    echo "  OK: $(basename "$f") ($COUNT offers)"
  else
    echo "  FAIL: $(basename "$f") — invalid JSON!"
    VALID=false
  fi
done

if [ "$VALID" = true ]; then
  echo ""
  echo "All data files valid. Update complete."
else
  echo ""
  echo "WARNING: Some data files have errors. Check logs."
  exit 1
fi

echo ""
echo "Done at $(date)"
