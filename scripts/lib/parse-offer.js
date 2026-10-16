/**
 * Turns a deal-blog post (or one item of a roundup page) into an offer.
 *
 * Handles the title shapes the three old scrapers each half-covered:
 *   "AmEx Offers: Uniqlo, Spend $100 Get $20 Back"
 *   "Amex Offer: Spend $50, Get $10 Back At Starbucks"
 *   "[Targeted] AmEx Offers: Get 20% Back On Dell (Up To $100)"
 *   "Bank of America Deals: Starbucks $10 Off $20"
 * Returns null for anything that is not clearly a live offer, since a
 * missing offer costs less than a wrong one.
 */

const { resolve } = require("../../lib/merchants");

const DEAD_TAG = /\[(?:expired|dead|ended|over)\]|^\s*(?:expired|dead)\b/i;
const LEADING_TAGS = /^(?:\s*\[[^\]]*\]\s*)+/;
const VERB_LED = /^(?:spend|get|earn|receive|save|buy|use|pay|enroll|register|targeted|ymmv)\b/i;

const CATEGORY_EMOJI = {
  travel: "✈️", dining: "🍽️", shopping: "🛍️", grocery: "🛒",
  entertainment: "📺", gas: "⛽", home: "🏠", wellness: "🏋️",
};
const MERCHANT_EMOJI = {
  airbnb: "🏠", turo: "🚗", "booking.com": "🏨", hilton: "🏨", marriott: "🏨",
  hyatt: "🏨", walmart: "🏪", amazon: "📦", dell: "💻", "best buy": "📺",
  starbucks: "☕", chipotle: "🌯", domino: "🍕", spotify: "🎵", nike: "👟",
  cruise: "🚢", "jack in the box": "🍔", midas: "🔧", "youtube tv": "📺",
};

const num = (s) => parseInt(String(s).replace(/,/g, ""), 10);

function parseValue(text) {
  const dollar =
    text.match(/\$\s?(\d[\d,]*)\s*(?:back|off|statement\s+credit|credit|cash\s*back)\b/i) ||
    text.match(/\b(?:get|earn|receive|save)\s+(?:a\s+)?\$\s?(\d[\d,]*)\b/i);
  const pct =
    text.match(/(\d+(?:\.\d+)?)\s?%\s*(?:back|off|cash\s*back|statement\s+credit)\b/i) ||
    text.match(/\b(?:get|earn|save)\s+(\d+(?:\.\d+)?)\s?%/i);
  const perDollar = text.match(/\+\s?(\d+)\s*(?:x|(?:mr\s+|membership\s+rewards\s+|ur\s+)?points?\s*(?:per|\/)\s*(?:dollar|\$))/i);
  const points = text.match(/\b(?:get|earn)\s+\+?(\d[\d,]*)\s*(?:bonus\s+)?(?:membership\s+rewards\s+|ultimate\s+rewards\s+|mr\s+|ur\s+)?points\b/i);
  const spend =
    text.match(/\bspend(?:ing)?\s+\$\s?(\d[\d,]*)/i) ||
    text.match(/\$\s?\d[\d,]*\s*off\s+\$\s?(\d[\d,]*)/i) ||          // "$10 off $20"
    text.match(/\$(\d[\d,]*)\s*\+\s*(?:purchase|spend)/i);
  const max = text.match(/\b(?:up\s+to|max(?:imum)?(?:\s+of)?)\s+\$\s?(\d[\d,]*)/i);

  const minSpend = spend ? `$${num(spend[1])}` : "None";
  const maxReward = max ? `$${num(max[1])}` : null;
  const onSpend = spend ? ` on $${num(spend[1])}+` : "";

  if (dollar) {
    const n = num(dollar[1]);
    return { value: `$${n} back${onSpend}`, valueNum: n, minSpend, maxReward: maxReward || `$${n}` };
  }
  if (pct) {
    const n = parseFloat(pct[1]);
    return { value: `${n}% back${maxReward ? ` (up to ${maxReward})` : ""}`, valueNum: n, minSpend, maxReward: maxReward || "Varies" };
  }
  if (perDollar) {
    const n = num(perDollar[1]);
    return { value: `+${n} pts/$${maxReward ? ` (up to ${maxReward})` : ""}`, valueNum: n, minSpend, maxReward: maxReward || "Varies" };
  }
  if (points) {
    const n = num(points[1]);
    // Points are compared to cash at ~1¢ so sorting by value stays sane.
    return { value: `${n.toLocaleString("en-US")} points${onSpend}`, valueNum: Math.round(n / 100), minSpend, maxReward: maxReward || "Varies" };
  }
  return null;
}

function cleanMerchant(raw) {
  if (!raw) return null;
  let m = raw
    .replace(/\s*\((?:[^)]*)\)\s*$/, "")          // trailing "(Limit 1)"
    .replace(/\s+(?:offers?|deals?)$/i, "")
    .replace(/[\s.,:;–—-]+$/, "")
    .trim();
  // Cut where the value phrase starts: "Starbucks $10 Off $20" → "Starbucks".
  m = m.split(/\s+(?=\$|\d+(?:\.\d+)?\s?%|(?:spend|get|earn|save|receive)\b)/i)[0].trim();
  if (m.length < 2 || m.length > 60) return null;
  if (VERB_LED.test(m) || /^\$|^\d+%/.test(m)) return null;
  return m;
}

/** "Get 20% back on Dell (up to $100)" → "Dell" */
function merchantAfterPreposition(text) {
  const m = text.match(
    // Titles are title-cased ("Back At Starbucks"), so the preposition is
    // matched either way while the merchant must still start with a capital.
    /\b(?:[Aa]t|[Oo]n|[Ww]ith|[Ff]rom)\s+(?!\$|\d)([A-Z0-9][^,(\[|–—]*?)(?=\s*(?:[,(\[|–—]|\s-\s|$|\s+(?:[Ww]hen|[Tt]hrough|[Tt]hru|[Uu]ntil|[Bb]y|[Aa]fter|[Vv]ia|[Pp]urchases?)\b))/
  );
  return m ? cleanMerchant(m[1]) : null;
}

function findMerchant(rest) {
  const first = rest.split(/,|\s[-–—]\s|:|\|/)[0].trim();
  if (first && !VERB_LED.test(first)) {
    const m = cleanMerchant(first);
    if (m) return m;
  }
  return merchantAfterPreposition(rest);
}

function pickEmoji(merchant, category) {
  const lower = merchant.toLowerCase();
  for (const [key, emoji] of Object.entries(MERCHANT_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return CATEGORY_EMOJI[category] || "🏷️";
}

/**
 * @param {object} p
 * @param {string} p.title        post title or roundup heading
 * @param {string} [p.merchantHint] merchant already known from page structure
 * @param {RegExp} [p.prefix]     issuer prefix to strip ("AmEx Offers:")
 * @returns {object|null} merchant, value fields, category, emoji
 */
function parseOffer({ title, merchantHint = null, prefix = null }) {
  if (!title || DEAD_TAG.test(title)) return null;

  let rest = title.replace(LEADING_TAGS, "").trim();
  if (prefix) rest = rest.replace(prefix, "").trim();

  const value = parseValue(rest);
  if (!value) return null;

  const merchant = (merchantHint && cleanMerchant(merchantHint)) || findMerchant(rest);
  if (!merchant) return null;

  const category = resolve(merchant).category || resolve(rest).category || "shopping";

  return { merchant, ...value, category, emoji: pickEmoji(merchant, category) };
}

module.exports = { parseOffer, parseValue, cleanMerchant };
