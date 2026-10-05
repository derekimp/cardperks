/**
 * The answer engine. Transport-agnostic on purpose: every channel adapter
 * (iMessage, WhatsApp, CLI, HTTP) calls ask() and formats the result.
 *
 * Deterministic by design — no model inference on the hot path, so a reply is
 * a few milliseconds of JSON lookups. What makes the answer worth asking for
 * is the data: today's targeted offers plus the cards you actually hold.
 */

const { loadOffers } = require("./offers");
const { loadCatalog, selectCards, rankCards } = require("./cards");
const { resolve, normalize, containsToken } = require("./merchants");

const STALE_AFTER_DAYS = 14;
const MAX_CARDS = 3;
const MAX_BROWSE_OFFERS = 5;

const BROWSE_PATTERNS = [
  /\bperks?\b/i,
  /\boffers?\b/i,
  /\bdeals?\b/i,
  /\bcoupons?\b/i,
  /\bcredits?\b/i,
  /anything good/i,
  /what'?s (new|around|available|good)/i,
];

function looksLikeBrowse(question) {
  return BROWSE_PATTERNS.some((re) => re.test(question || ""));
}

/** An offer is "for" a merchant if either name contains the other as a token. */
function offerMatchesMerchant(offer, merchant) {
  const a = normalize(offer.merchant);
  const b = normalize(merchant);
  if (!a || !b) return false;
  return a === b || containsToken(a, b) || containsToken(b, a);
}

function byValueDesc(a, b) {
  return (b.valueNum || 0) - (a.valueNum || 0);
}

/**
 * Answer one question.
 *
 * @param {string} question free text, e.g. "what card for uniqlo?"
 * @returns {object} structured answer — see lib/format.js for rendering
 */
function ask(question, { now = new Date(), dataDir } = {}) {
  const offerData = loadOffers({ now, dataDir });
  const { catalog, wallet } = loadCatalog({ dataDir });
  const { cards, usingWallet } = selectCards(catalog, wallet);
  const resolved = resolve(question, { dataDir });

  const warnings = [];
  if (offerData.staleDays !== null && offerData.staleDays > STALE_AFTER_DAYS) {
    warnings.push(
      `Offer data is ${offerData.staleDays} days old (last refreshed ${offerData.lastUpdated}), so targeted offers may be missing.`
    );
  }
  if (!offerData.offers.length && offerData.expiredCount > 0) {
    warnings.push(
      `All ${offerData.expiredCount} scraped offers have expired, so nothing targeted is available to match against.`
    );
  }

  const base = {
    question,
    merchant: resolved.merchant,
    category: resolved.category,
    channel: resolved.channel,
    matchedBy: resolved.matchedBy,
    usingWallet,
    dataAsOf: offerData.lastUpdated,
    warnings,
  };

  if (!resolved.category) {
    if (looksLikeBrowse(question)) {
      return {
        ...base,
        intent: "browse",
        offers: offerData.offers.slice().sort(byValueDesc).slice(0, MAX_BROWSE_OFFERS),
        totalLive: offerData.offers.length,
      };
    }
    return { ...base, intent: "help" };
  }

  const merchantOffers = resolved.merchant
    ? offerData.offers.filter((o) => offerMatchesMerchant(o, resolved.merchant)).sort(byValueDesc)
    : [];

  const categoryOffers = offerData.offers
    .filter((o) => o.category === resolved.category && !merchantOffers.includes(o))
    .sort(byValueDesc)
    .slice(0, 2);

  const ranked = rankCards(cards, resolved.category, {
    channel: resolved.channel,
    now,
    valuations: catalog.valuations,
  });

  return {
    ...base,
    intent: "recommend",
    offers: merchantOffers,
    categoryOffers,
    cards: ranked.slice(0, MAX_CARDS),
  };
}

module.exports = { ask, looksLikeBrowse, STALE_AFTER_DAYS };
