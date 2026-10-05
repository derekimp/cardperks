/**
 * Source → offers for one issuer: fetch every source, parse, merge
 * duplicates, assign real or estimated expiries, drop what has expired.
 */

const { fetchTaggedPosts } = require("./wordpress");
const roundups = require("./roundups");
const { parseOffer } = require("./parse-offer");
const { parseExpiry, isoDate, addDays, DAY_MS } = require("./dates");

const DEFAULTS = {
  windowDays: 120, // ignore posts older than this
  ttlDays: 30,     // assumed lifetime when a post states no end date
  graceDays: 7,    // matches the front end's grace period in js/app.js
  newDays: 7,      // "New" badge
  maxPages: 3,
};

function slug(str) {
  return String(str).toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isHot({ value, valueNum }) {
  if (/%/.test(value)) return valueNum >= 15;
  if (/pts\/\$/.test(value)) return valueNum >= 5;
  return valueNum >= 25;
}

async function collect(http, source, { now, since, maxPages }) {
  if (source.type === "wordpress") {
    const { via, posts } = await fetchTaggedPosts(http, { site: source.site, tag: source.tag, since, maxPages });
    return {
      via,
      items: posts.map((p) => ({ title: p.title, text: `${p.title} ${p.text}`, link: p.link, postedAt: p.date })),
    };
  }

  const parse = roundups[source.type];
  if (!parse) throw new Error(`unknown source type "${source.type}"`);
  const res = await http.get(source.url);
  return {
    via: "page",
    // A roundup is current as of the moment it is read.
    items: parse(res.body).map((r) => ({ ...r, text: `${r.title} ${r.text}`, link: source.url, postedAt: now })),
  };
}

function toOffer(item, parsed, cfg, opts) {
  const explicit = parseExpiry(item.text, item.postedAt);
  const ageMs = opts.now - item.postedAt;
  const minSpendNote = parsed.minSpend !== "None" ? ` Minimum spend: ${parsed.minSpend}.` : "";

  return {
    id: null,
    merchant: parsed.merchant,
    emoji: parsed.emoji,
    value: parsed.value,
    valueNum: parsed.valueNum,
    description: `${parsed.value} at ${parsed.merchant}.${minSpendNote} ${cfg.howTo}`.trim(),
    category: parsed.category,
    expiry: explicit || isoDate(addDays(item.postedAt, opts.ttlDays)),
    expiryEstimated: !explicit,
    isNew: ageMs <= opts.newDays * DAY_MS,
    isHot: isHot(parsed),
    minSpend: parsed.minSpend,
    maxReward: parsed.maxReward,
    terms: cfg.terms,
    sourceUrl: item.link,
    postedAt: isoDate(item.postedAt),
  };
}

/** A confirmed expiry beats an estimate; then the newer post; then the bigger reward. */
function better(a, b) {
  if (a.expiryEstimated !== b.expiryEstimated) return !a.expiryEstimated;
  if (a.postedAt !== b.postedAt) return a.postedAt > b.postedAt;
  return a.valueNum > b.valueNum;
}

function mergeOffers(offers) {
  const byMerchant = new Map();
  for (const offer of offers) {
    const key = slug(offer.merchant);
    const current = byMerchant.get(key);
    if (!current || better(offer, current)) byMerchant.set(key, offer);
  }
  return [...byMerchant.values()];
}

/**
 * @returns {Promise<{offers: object[], stats: object[], allSourcesFailed: boolean}>}
 */
async function scrapeIssuer(http, issuerKey, cfg, options = {}) {
  const opts = { ...DEFAULTS, now: new Date(), ...options };
  const since = addDays(opts.now, -opts.windowDays);
  const stats = [];
  const parsedOffers = [];

  for (const source of cfg.sources) {
    const stat = { name: source.name, type: source.type, via: null, items: 0, parsed: 0, error: null };
    try {
      const { via, items } = await collect(http, source, { now: opts.now, since, maxPages: opts.maxPages });
      stat.via = via;
      stat.items = items.length;
      for (const item of items) {
        // A post with an unreadable date cannot be aged or expired safely.
        if (Number.isNaN(item.postedAt.getTime())) continue;
        const parsed = parseOffer({ title: item.title, merchantHint: item.merchantHint, prefix: cfg.prefix });
        if (!parsed) continue;
        parsedOffers.push(toOffer(item, parsed, cfg, opts));
        stat.parsed++;
      }
    } catch (err) {
      stat.error = err.message;
    }
    stats.push(stat);
  }

  const cutoff = isoDate(addDays(opts.now, -opts.graceDays));
  const offers = mergeOffers(parsedOffers)
    .filter((o) => o.expiry >= cutoff)
    .sort((a, b) => (b.postedAt.localeCompare(a.postedAt)) || a.merchant.localeCompare(b.merchant));

  for (const offer of offers) offer.id = `${issuerKey}-${slug(offer.merchant)}`;

  return { offers, stats, allSourcesFailed: stats.every((s) => s.error) };
}

/**
 * Whether to overwrite an issuer's data file.
 *   "empty"     — nothing parsed; keep the old file (a blocked or broken source
 *                 must not wipe the site)
 *   "unchanged" — identical offers; skip the write so a no-op run makes no commit
 *   "write"     — new data
 */
function decideWrite(existingOffers, nextOffers) {
  if (!nextOffers.length) return "empty";
  if (JSON.stringify(existingOffers || []) === JSON.stringify(nextOffers)) return "unchanged";
  return "write";
}

module.exports = { scrapeIssuer, mergeOffers, decideWrite, slug, DEFAULTS };
