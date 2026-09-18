/**
 * Card catalog: which card earns the most in a given spend category.
 *
 * Rates live in data/cards.json in their native currency (points or cash),
 * so everything is converted to an "effective percent back" via the
 * cents-per-point valuations in that file before cards are compared.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

// Rates flagged with this pseudo-category apply to whichever category you
// selected or spent the most in, so they are offered as a caveat, not a fact.
const CHOOSABLE = "any-top-category";

function loadCatalog({ dataDir = DATA_DIR } = {}) {
  const cards = JSON.parse(fs.readFileSync(path.join(dataDir, "cards.json"), "utf8"));
  let wallet = { cards: [] };
  try {
    wallet = JSON.parse(fs.readFileSync(path.join(dataDir, "wallet.json"), "utf8"));
  } catch (_) {
    // No wallet configured: fall through and consider the whole catalog.
  }
  return { catalog: cards, wallet };
}

/** Cards the user holds, or the whole catalog when the wallet is empty. */
function selectCards(catalog, wallet) {
  const held = (wallet && wallet.cards) || [];
  if (!held.length) return { cards: catalog.cards, usingWallet: false };

  const byId = new Map(catalog.cards.map((c) => [c.id, c]));
  const cards = held.map((id) => byId.get(id)).filter(Boolean);
  const unknown = held.filter((id) => !byId.has(id));
  return { cards: cards.length ? cards : catalog.cards, usingWallet: cards.length > 0, unknown };
}

function withinWindow(rate, now) {
  if (rate.activeFrom && new Date(rate.activeFrom) > now) return false;
  if (rate.activeTo && new Date(rate.activeTo) < now) return false;
  return true;
}

/**
 * Best applicable rate on one card for a category.
 *
 * `channel` is "online", "in-store", or null when the question did not say.
 * An unknown channel keeps channel-specific rates in play but marks them
 * conditional, so the reply can say "only online" instead of overpromising.
 */
function bestRate(card, category, { channel = null, now = new Date(), valuations }) {
  const value = (valuations && valuations[card.currency]) || 1.0;
  const candidates = [];

  for (const rate of card.rates || []) {
    const choosable = rate.category === CHOOSABLE;
    if (!choosable && rate.category !== category) continue;
    if (!withinWindow(rate, now)) continue;
    if (rate.channel && channel && rate.channel !== channel) continue;

    const conditions = [];
    if (choosable) conditions.push("only if it is one of your selected categories");
    if (rate.rotating) conditions.push("rotating category, activation required");
    if (rate.channel && !channel) conditions.push(`${rate.channel} purchases only`);

    candidates.push({
      rate: rate.rate,
      effective: rate.rate * value,
      note: rate.note,
      cap: rate.cap || null,
      conditions,
      isBase: false,
    });
  }

  const base = {
    rate: card.baseRate,
    effective: card.baseRate * value,
    note: `${card.baseRate}x on everything else`,
    cap: null,
    conditions: [],
    isBase: true,
  };
  candidates.push(base);

  // Prefer the highest effective value; break ties toward the unconditional one.
  candidates.sort((a, b) => b.effective - a.effective || a.conditions.length - b.conditions.length);
  const best = candidates[0];

  return {
    cardId: card.id,
    cardName: card.name,
    issuer: card.issuer,
    currency: card.currency,
    ...best,
  };
}

/** Every card ranked by effective value for this category, best first. */
function rankCards(cards, category, opts) {
  return cards
    .map((card) => bestRate(card, category, opts))
    .sort((a, b) => b.effective - a.effective || a.conditions.length - b.conditions.length);
}

module.exports = { loadCatalog, selectCards, bestRate, rankCards, CHOOSABLE };
