#!/usr/bin/env node
/**
 * Bank of America (BankAmeriDeals) Offers Scraper
 *
 * Scrapes current BofA offers from public aggregator sites and outputs
 * a JSON file to data/bofa-offers.json.
 *
 * Sources:
 *  - Doctor of Credit (BofA deal posts)
 *  - Cards & Points (BankAmeriDeals roundups)
 *
 * Usage:
 *   node scripts/scrape-bofa.js
 *   node scripts/scrape-bofa.js --dry-run
 *
 * Dependencies:
 *   npm install cheerio node-fetch@2
 */

const cheerio = require("cheerio");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "bofa-offers.json");

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
    "hyatt", "hertz", "turo", "resort",
  ],
  dining: [
    "restaurant", "food", "eat", "dining", "pizza", "burger", "sushi",
    "grubhub", "doordash", "uber eats", "chipotle", "starbucks",
    "panera", "shake shack", "domino", "firehouse", "five guys",
    "a&w", "sonic", "subway", "taco",
  ],
  shopping: [
    "walmart", "amazon", "target", "best buy", "dell", "nike",
    "nordstrom", "macy", "shop", "store", "retail", "cvs", "walgreens",
    "midas", "drugstore",
  ],
  grocery: [
    "grocery", "supermarket", "whole foods", "kroger", "costco",
    "sam's club", "instacart", "safeway", "wholesale",
  ],
  entertainment: [
    "youtube", "spotify", "netflix", "hulu", "disney", "amc",
    "movie", "theatre", "theater", "stream", "music", "tv",
    "seatgeek", "topgolf", "ticket",
  ],
  gas: ["gas", "fuel", "exxon", "shell", "chevron", "bp", "amoco", "texaco", "holiday"],
  home: ["home depot", "lowe", "home", "furniture", "wayfair", "ikea"],
  wellness: ["gym", "fitness", "peloton", "soulcycle", "yoga", "wellness"],
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
  entertainment: "📺", gas: "⛽", home: "🏠", wellness: "🏋️",
};
const MERCHANT_EMOJI = {
  "shake shack": "🍔", seatgeek: "🎟️", hilton: "🏨", dell: "💻",
  cvs: "💊", midas: "🔧", "a&w": "🍺", topgolf: "⛳",
  "five guys": "🍟", "youtube tv": "📺", turo: "🚗", starbucks: "☕",
  holiday: "⛽", walmart: "🏪", amazon: "📦", target: "🎯",
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

// ── Scraper: Doctor of Credit BofA deal posts ───────────────────────
async function scrapeDoctorOfCredit() {
  console.log("⏳ Scraping Doctor of Credit (BofA)...");
  const html = await fetchHTML(
    "https://www.doctorofcredit.com/tag/bank-of-america-deals/"
  );
  if (!html) return [];

  const $ = cheerio.load(html);
  const offers = [];
  const seen = new Set();

  $("article .entry-title a, h2.entry-title a").each((_, el) => {
    const title = $(el).text().trim();
    if (!title) return;
    if (title.toLowerCase().includes("expired")) return;

    // Parse titles like "Bank of America Deals: Starbucks $10 Off $20"
    const merchantMatch = title.match(
      /(?:Bank\s*of\s*America|BofA)\s*(?:Deals?)?:?\s*(.+?)(?:,|Spend|\||$)/i
    );
    if (!merchantMatch) return;
    const merchant = merchantMatch[1].trim();
    if (seen.has(merchant.toLowerCase())) return;
    seen.add(merchant.toLowerCase());

    const dollarBack = title.match(/(?:Get|Earn|Receive|\$)\s*\$?(\d+)\s*(?:back|off|cash\s*back)/i);
    const pctBack = title.match(/(?:Get|Earn|Save)\s*(\d+)%/i);
    const spend = title.match(/(?:Spend|minimum)\s*\$(\d[\d,]*)/i);

    let value = "";
    if (dollarBack) value = `$${dollarBack[1]} back`;
    else if (pctBack) value = `${pctBack[1]}% back`;
    if (!value) return;

    const minSpend = spend ? `$${spend[1].replace(",", "")}` : "None";
    const category = detectCategory(merchant + " " + title);

    offers.push({
      id: `bofa-doc-${offers.length + 1}`,
      merchant,
      emoji: pickEmoji(merchant, category),
      value: minSpend !== "None" ? `${value} on ${minSpend}+` : value,
      valueNum: parseValueNum(value),
      description: `${value} at ${merchant}.${minSpend !== "None" ? ` Minimum spend: ${minSpend}.` : ""} BankAmeriDeals offer — add to your BofA card.`,
      category,
      expiry: "2026-06-30",
      isNew: true,
      isHot: parseValueNum(value) >= 20,
      minSpend,
      maxReward: dollarBack ? `$${dollarBack[1]}` : "Varies",
      terms: "BankAmeriDeals offer. One-time use. Payment made directly with merchant. Targeted offer.",
      sourceUrl: $(el).attr("href") || "https://www.doctorofcredit.com/tag/bank-of-america-deals/",
    });
  });

  console.log(`  ✓ Doctor of Credit: found ${offers.length} BofA offers`);
  return offers;
}

// ── Scraper: Cards & Points BankAmeriDeals roundup ──────────────────
async function scrapeCardsAndPoints() {
  console.log("⏳ Scraping Cards & Points (BankAmeriDeals)...");
  const html = await fetchHTML(
    "https://www.cardsandpoints.com/bankamerideals/"
  );
  if (!html) return [];

  const $ = cheerio.load(html);
  const offers = [];

  // Look for merchant names and cashback info in article content
  $("article .entry-content p, article .entry-content li").each((_, el) => {
    const text = $(el).text().trim();
    if (!text || text.length < 10) return;

    const pctMatch = text.match(/(\d+)%\s*(?:cash\s*back|back)/i);
    const dollarMatch = text.match(/\$(\d+)\s*(?:cash\s*back|back)/i);
    if (!pctMatch && !dollarMatch) return;

    // Try to extract merchant name (usually at start of line or bold)
    const merchantMatch = text.match(/^([A-Z][A-Za-z\s&'.]+?)[\s:–—-]+\d+%/);
    if (!merchantMatch) return;

    const merchant = merchantMatch[1].trim();
    const value = pctMatch ? `${pctMatch[1]}% back` : `$${dollarMatch[1]} back`;
    const category = detectCategory(merchant + " " + text);
    const maxMatch = text.match(/\$(\d+)\s*(?:cash\s*back\s*)?(?:max|maximum)/i);

    offers.push({
      id: `bofa-cp-${offers.length + 1}`,
      merchant,
      emoji: pickEmoji(merchant, category),
      value,
      valueNum: parseValueNum(value),
      description: text.slice(0, 300),
      category,
      expiry: "2026-06-30",
      isNew: false,
      isHot: parseValueNum(value) >= 10,
      minSpend: "None",
      maxReward: maxMatch ? `$${maxMatch[1]}` : "Varies",
      terms: "BankAmeriDeals offer. One-time use. Targeted offer.",
      sourceUrl: "https://www.cardsandpoints.com/bankamerideals/",
    });
  });

  console.log(`  ✓ Cards & Points: found ${offers.length} BofA offers`);
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
  console.log("🔍 Bank of America Offers Scraper\n");

  const results = await Promise.all([
    scrapeDoctorOfCredit(),
    scrapeCardsAndPoints(),
  ]);

  const allOffers = results.flat();
  console.log(`\n📊 Total raw offers: ${allOffers.length}`);

  const deduped = deduplicateOffers(allOffers);
  console.log(`📊 After dedup: ${deduped.length}`);

  // Re-index IDs
  deduped.forEach((o, i) => {
    o.id = `bofa-${String(i + 1).padStart(3, "0")}`;
  });

  const output = {
    issuer: "bofa",
    issuerName: "Bank of America",
    lastUpdated: new Date().toISOString().split("T")[0],
    source: "Aggregated from Doctor of Credit, Cards & Points, and other public deal sites",
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
