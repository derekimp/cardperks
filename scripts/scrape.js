#!/usr/bin/env node
/**
 * Refreshes data/<issuer>-offers.json from the sources in scripts/sources.js.
 *
 *   node scripts/scrape.js --all
 *   node scripts/scrape.js --issuer amex --dry-run
 *   node scripts/scrape.js --issuer chase,bofa --max-pages 5 --window-days 90
 *
 * Exits non-zero when any issuer comes back empty, so a scheduled run that
 * gets blocked fails loudly instead of silently leaving stale data. An empty
 * result never overwrites an existing file.
 */

const fs = require("fs");
const path = require("path");

const SOURCES = require("./sources");
const { createHttp } = require("./lib/http");
const { scrapeIssuer, decideWrite, DEFAULTS } = require("./lib/pipeline");

const DATA_DIR = path.join(__dirname, "..", "data");

function parseArgs(argv) {
  const args = { issuers: [], dryRun: false, maxPages: DEFAULTS.maxPages, windowDays: DEFAULTS.windowDays };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.issuers = Object.keys(SOURCES);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--issuer") args.issuers.push(...String(argv[++i] || "").split(","));
    else if (a === "--max-pages") args.maxPages = parseInt(argv[++i], 10);
    else if (a === "--window-days") args.windowDays = parseInt(argv[++i], 10);
    else throw new Error(`Unknown argument: ${a}`);
  }
  args.issuers = [...new Set(args.issuers.map((s) => s.trim()).filter(Boolean))];
  return args;
}

function readExisting(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.issuers.length) {
    console.error(`Usage: node scripts/scrape.js --all | --issuer ${Object.keys(SOURCES).join("|")} [--dry-run]`);
    process.exit(2);
  }
  const unknown = args.issuers.filter((k) => !SOURCES[k]);
  if (unknown.length) throw new Error(`Unknown issuer(s): ${unknown.join(", ")}`);

  const http = createHttp();
  const failures = [];

  for (const key of args.issuers) {
    const cfg = SOURCES[key];
    console.log(`\n── ${cfg.issuerName} ──`);

    const { offers, stats } = await scrapeIssuer(http, key, cfg, {
      maxPages: args.maxPages,
      windowDays: args.windowDays,
    });

    for (const s of stats) {
      const detail = s.error ? `FAILED: ${s.error}` : `${s.parsed}/${s.items} items parsed via ${s.via}`;
      console.log(`  ${s.error ? "✗" : "✓"} ${s.name}: ${detail}`);
    }
    const estimated = offers.filter((o) => o.expiryEstimated).length;
    console.log(`  → ${offers.length} live offers after merge (${estimated} with estimated expiry)`);

    const file = path.join(DATA_DIR, `${key}-offers.json`);
    const existing = readExisting(file);
    const decision = decideWrite(existing && existing.offers, offers);

    if (decision === "empty") {
      failures.push(key);
      console.error(`  ✗ No offers parsed — keeping the existing ${path.basename(file)}.`);
      continue;
    }

    const output = {
      issuer: key,
      issuerName: cfg.issuerName,
      lastUpdated: new Date().toISOString().slice(0, 10),
      source: `Aggregated from ${cfg.sources.map((s) => s.name).join(", ")}`,
      offers,
    };

    if (args.dryRun) {
      console.log(JSON.stringify(output, null, 2));
    } else if (decision === "unchanged") {
      console.log(`  = Offers unchanged — ${path.basename(file)} left as is.`);
    } else {
      fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
      console.log(`  ✓ Wrote ${path.basename(file)}`);
    }
  }

  if (failures.length) {
    console.error(`\nFailed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs };
