#!/usr/bin/env node
/**
 * Chase Offers Scraper
 *
 * Scrapes current Chase offers from public aggregator sites and outputs
 * a JSON file to data/chase-offers.json.
 *
 * Sources:
 *  - AwardWallet (travel offers)
 *  - Doctor of Credit (individual offer posts)
 *  - Frequent Miler (merchant offer roundups)
 *
 * Usage:
 *   node scripts/scrape-chase.js
 *   node scripts/scrape-chase.js --dry-run   # print without writing file
 *
 * Dependencies:
 *   npm install cheerio node-fetch@2
 *
 * Note: These sites may block automated requests or change their HTML
 * structure. This scraper should be run periodically and the output
 * reviewed before publishing.
 */

const cheerio = require("cheerio");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "chase-offers.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── Category detection ──────────────────────────────────────────────
const CATEGORY_KEYWORDS = {
  travel: [
    "hotel", "flight", "airline", "cruise", "rental", "car rental",
    "airbnb", "vrbo", "booking.com", "expedia", "hilton", "marriott",
    "hyatt", "hertz", "turo", "clear", "tsa", "safari", "resort",
    "brightline", "lyft", "united", "southwest", "air india", "aer lingus",
    "british airways", "chase travel", "airfare",
  ],
  dining: [
    "restaurant", "food", "eat", "dining", "pizza", "burger", "sushi",
    "grubhub", "doordash", "uber eats", "chipotle", "starbucks",
    "panera", "shake shack", "domino", "firehouse", "jack in the box",
    "sonic", "subway", "taco",
  ],
  shopping: [
    "walmart", "amazon", "target", "best buy", "dell", "nike",
    "nordstrom", "macy", "lululemon", "shop", "store", "retail",
    "gopuff", "paze", "newegg", "cvs", "at&t", "verizon", "t-mobile",
    "visible", "wireless",
  ],
  grocery: [
    "grocery", "supermarket", "whole foods", "kroger", "costco",
    "sam's club", "instacart", "safeway", "trader joe",
  ],
  entertainment: [
    "youtube", "spotify", "netflix", "hulu", "disney", "amc",
    "movie", "theatre", "theater", "stream", "music", "tv", "calm",
  ],
  gas: ["gas", "fuel", "exxon", "shell", "chevron", "bp", "amoco", "texaco"],
  home: ["home depot", "lowe", "home", "furniture", "wayfair", "ikea"],
  wellness: ["gym", "fitness", "peloton", "soulcycle", "yoga", "wellness", "calm"],
};

function detectCategory(text) {
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return category;
    }
  }
  return "shopping";
}

// ── Emoji picker ────────────────────────────────────────────────────
const EMOJI_MAP = {
  travel: "✈️", dining: "🍽️", shopping: "🛍️", grocery: "🛒",
  entertainment: "📺", gas: "⛽", home: "🏠", wellness: "🧘",
};
const MERCHANT_EMOJI = {
  paze: "💳", turo: "🚗", lyft: "🚕", brightline: "🚄",
  airalo: "📶", starbucks: "☕", "sam's club": "📦", ikea: "🪑",
  calm: "🧘", cvs: "💊", "at&t": "📱", verizon: "📱",
  "t-mobile": "📱", united: "✈️", southwest: "✈️",
  "air india": "✈️", "british airways": "✈️", marriott: "🏨",
  hyatt: "🏨", ihg: "🏨", hilton: "🏨", "chase travel": "🏨",
  walmart: "🏪", amazon: "📦", target: "🎯", nike: "👟",
  "best buy": "📺", dell: "💻", newegg: "🖥️",
};

function pickEmoji(merchant, category) {
  const lower = merchant.toLowerCase();
  for (const [key, emoji] of Object.entries(MERCHANT_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return EMOJI_MAP[category] || "🏷️";
}

// ── Parse offer value into a numeric score ──────────────────────────
function parseValueNum(valueStr) {
  const dollarMatch = valueStr.match(/\$(\d+)/);
  if (dollarMatch) return parseInt(dollarMatch[1], 10);
  const pctMatch = valueStr.match(/(\d+)%/);
  if (pctMatch) return parseInt(pctMatch[1], 10);
  return 0;
}

// ── Fetch HTML ──────────────────────────────────────────────────────
async function fetchHTML(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, timeout: 15000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.error(`  ✗ Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

// ── Scraper: AwardWallet Chase offers ───────────────────────────────
async function scrapeAwardWallet() {
  console.log("⏳ Scraping AwardWallet (Chase)...");
  const html = await fetchHTML(
    "https://awardwallet.com/news/chase-ultimate-rewards/chase-offers/"
  );
  if (!html) return [];

  const $ = cheerio.load(html);
  const offers = [];

  $("article .entry-content h2, article .entry-content h3").each((_, el) => {
    const heading = $(el).text().trim();
    if (!heading) return;

    let desc = "";
    let next = $(el).next();
    while (next.length && !next.is("h2, h3")) {
      desc += next.text().trim() + " ";
      next = next.next();
    }
    desc = desc.trim();
    if (!desc || desc.length < 20) return;

    const combined = heading + " " + desc;
    const dollarBack = combined.match(/\$(\d+)\s*(?:back|cash\s*back|statement credit|off)/i);
    const pctBack = combined.match(/(\d+)%\s*(?:back|cash\s*back|off)/i);
    const spend = combined.match(/(?:spend|minimum)\s*(?:of\s*)?\$(\d[\d,]*)/i);
    const expiryMatch = combined.match(
      /(?:by|through|expires?|valid\s*(?:through|until|thru))\s*(\w+\s+\d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i
    );

    let value = "";
    if (dollarBack) value = `$${dollarBack[1]} back`;
    else if (pctBack) value = `${pctBack[1]}% back`;
    if (!value) return;

    const minSpend = spend ? `$${spend[1].replace(",", "")}` : "None";
    if (minSpend !== "None") value += ` on ${minSpend}+`;

    let expiry = "2026-06-30";
    if (expiryMatch) {
      try {
        const d = new Date(expiryMatch[1]);
        if (!isNaN(d)) expiry = d.toISOString().split("T")[0];
      } catch (_) {}
    }

    const category = detectCategory(combined);

    offers.push({
      id: `chase-aw-${offers.length + 1}`,
      merchant: heading.replace(/[:\-–—].*$/, "").trim().slice(0, 60),
      emoji: pickEmoji(heading, category),
      value: value.trim(),
      valueNum: parseValueNum(value),
      description: desc.slice(0, 300),
      category,
      expiry,
      isNew: false,
      isHot: parseValueNum(value) >= 50,
      minSpend,
      maxReward: dollarBack ? `$${dollarBack[1]}` : "Varies",
      terms: "Enrollment required. Targeted offer — may not appear for all cardholders.",
      sourceUrl: "https://awardwallet.com/news/chase-ultimate-rewards/chase-offers/",
    });
  });

  console.log(`  ✓ AwardWallet: found ${offers.length} Chase offers`);
  return offers;
}

// ── Scraper: Doctor of Credit recent posts ──────────────────────────
async function scrapeDoctorOfCredit() {
  console.log("⏳ Scraping Doctor of Credit (Chase)...");
  const html = await fetchHTML(
    "https://www.doctorofcredit.com/tag/chase-offers/"
  );
  if (!html) return [];

  const $ = cheerio.load(html);
  const offers = [];
  const seen = new Set();

  $("article .entry-title a, h2.entry-title a").each((_, el) => {
    const title = $(el).text().trim();
    if (!title) return;
    if (title.toLowerCase().includes("expired")) return;

    // Parse title like "Chase Offers: GoPuff, Spend $30 & Get $10"
    const merchantMatch = title.match(/Chase\s*Offers?:?\s*(.+?)(?:,|Spend|\||$)/i);
    if (!merchantMatch) return;
    const merchant = merchantMatch[1].trim();
    if (seen.has(merchant.toLowerCase())) return;
    seen.add(merchant.toLowerCase());

    const dollarBack = title.match(/(?:Get|Earn|Receive)\s*\$(\d+)/i);
    const pctBack = title.match(/(?:Get|Earn|Save)\s*(\d+)%/i);
    const spend = title.match(/Spend\s*\$(\d[\d,]*)/i);

    let value = "";
    if (dollarBack) value = `$${dollarBack[1]} back`;
    else if (pctBack) value = `${pctBack[1]}% back`;
    if (!value) return;

    const minSpend = spend ? `$${spend[1].replace(",", "")}` : "None";
    const category = detectCategory(merchant + " " + title);

    offers.push({
      id: `chase-doc-${offers.length + 1}`,
      merchant,
      emoji: pickEmoji(merchant, category),
      value: minSpend !== "None" ? `${value} on ${minSpend}+` : value,
      valueNum: parseValueNum(value),
      description: `${value} at ${merchant}.${minSpend !== "None" ? ` Minimum spend: ${minSpend}.` : ""} Add offer to your Chase card before purchase.`,
      category,
      expiry: "2026-06-30",
      isNew: true,
      isHot: parseValueNum(value) >= 20,
      minSpend,
      maxReward: dollarBack ? `$${dollarBack[1]}` : "Varies",
      terms: "Enrollment required. Targeted offer — may not appear for all cardholders.",
      sourceUrl: $(el).attr("href") || "https://www.doctorofcredit.com/tag/chase-offers/",
    });
  });

  console.log(`  ✓ Doctor of Credit: found ${offers.length} Chase offers`);
  return offers;
}

// ── Merge & deduplicate ─────────────────────────────────────────────
function deduplicateOffers(allOffers) {
  const seen = new Map();
  for (const offer of allOffers) {
    const key = offer.merchant.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!seen.has(key) || offer.valueNum > seen.get(key).valueNum) {
      seen.set(key, offer);
    }
  }
  return Array.from(seen.values());
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("🔍 Chase Offers Scraper\n");

  const results = await Promise.all([
    scrapeAwardWallet(),
    scrapeDoctorOfCredit(),
  ]);

  const allOffers = results.flat();
  console.log(`\n📊 Total raw offers: ${allOffers.length}`);

  const deduped = deduplicateOffers(allOffers);
  console.log(`📊 After dedup: ${deduped.length}`);

  // Re-index IDs
  deduped.forEach((o, i) => {
    o.id = `chase-${String(i + 1).padStart(3, "0")}`;
  });

  const output = {
    issuer: "chase",
    issuerName: "Chase",
    lastUpdated: new Date().toISOString().split("T")[0],
    source: "Aggregated from AwardWallet, Doctor of Credit, and other public deal sites",
    offers: deduped,
  };

  if (DRY_RUN) {
    console.log("\n🏷️  --dry-run: printing JSON to stdout\n");
    console.log(JSON.stringify(output, null, 2));
  } else {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`\n✅ Written ${deduped.length} offers to ${OUTPUT_PATH}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
