/**
 * Renders an engine answer as plain text for a messaging thread.
 *
 * Messaging apps do not render markdown, so this stays to line breaks,
 * numbers and a couple of emoji. Replies are kept short enough to read
 * without scrolling on a phone.
 */

const CASH_CURRENCIES = new Set(["cash", "bofa-cash"]);

function rateLabel(card) {
  const isCash = CASH_CURRENCIES.has(card.currency);
  const rate = `${card.rate}${isCash ? "%" : "x"}`;
  if (isCash) return `${rate} back`;
  return `${rate} (~${card.effective.toFixed(1)}% value)`;
}

const STOPWORDS = new Set([
  "only", "if", "it", "is", "one", "of", "your", "the", "a", "an", "and", "or",
  "on", "in", "at", "for", "this", "that", "each", "per", "you", "be", "are",
]);

function contentWords(str) {
  return String(str)
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * A condition is redundant when the rate's own note already says it — most of
 * the catalog's notes spell out activation and channel restrictions inline.
 */
function isRedundant(condition, note) {
  if (!note) return false;
  const words = contentWords(condition);
  if (!words.length) return false;
  const inNote = new Set(contentWords(note));
  const overlap = words.filter((w) => inNote.has(w)).length;
  return overlap / words.length >= 0.6;
}

/**
 * One card as one or two lines: the headline rate, then the fine print that
 * decides whether the rate actually applies.
 */
function cardLines(card, index) {
  const lines = [`${index + 1}. ${card.cardName} — ${rateLabel(card)}`];
  const detail = [];
  if (!card.isBase && card.note) detail.push(card.note);
  const conditions = card.conditions.filter((c) => !isRedundant(c, card.isBase ? null : card.note));
  if (conditions.length) detail.push(conditions.join("; "));
  if (card.cap) detail.push(`cap ${card.cap}`);
  if (detail.length) lines.push(`   ${detail.join(" · ")}`);
  return lines;
}

function offerLine(offer) {
  const bits = [`• ${offer.merchant}: ${offer.value} [${offer.issuerName}]`];
  if (offer.expiryEstimated) bits.push("— expiry unconfirmed, check your card's offers");
  else if (offer.expiry) bits.push(`— expires ${offer.expiry}`);
  return bits.join(" ");
}

function titleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function helpText() {
  return [
    "CardPerks — ask me what to pay with.",
    "",
    "Try:",
    '• "what card for uniqlo?"',
    '• "any perks at trader joes"',
    '• "booking a flight, which card"',
    '• "what perks are around"',
  ].join("\n");
}

function toText(answer) {
  if (answer.intent === "help") return helpText();

  const lines = [];

  if (answer.intent === "browse") {
    if (!answer.offers.length) {
      lines.push("No live targeted offers right now.");
      lines.push('Ask about a specific store — e.g. "what card for uniqlo?" — and I can still tell you which card earns the most.');
    } else {
      lines.push(`Top offers right now (${answer.totalLive} live):`);
      answer.offers.forEach((o) => lines.push(offerLine(o)));
    }
  } else {
    const heading = answer.merchant
      ? `${answer.merchant} · ${answer.category}`
      : `${titleCase(answer.category)} purchase`;
    lines.push(heading + (answer.channel ? ` (${answer.channel})` : ""));
    lines.push("");

    if (answer.offers.length) {
      lines.push("Targeted offer on your account list:");
      answer.offers.forEach((o) => lines.push(offerLine(o)));
      lines.push("");
    } else if (answer.merchant) {
      lines.push(`No live targeted offer for ${answer.merchant}.`);
      lines.push("");
    }

    if (answer.cards && answer.cards.length) {
      lines.push(
        answer.usingWallet
          ? `Best card in your wallet for ${answer.category}:`
          : `Best cards for ${answer.category}:`
      );
      answer.cards.forEach((c, i) => lines.push(...cardLines(c, i)));
    }

    if (answer.categoryOffers && answer.categoryOffers.length) {
      lines.push("");
      lines.push(`Also live in ${answer.category}:`);
      answer.categoryOffers.forEach((o) => lines.push(offerLine(o)));
    }
  }

  if (answer.warnings && answer.warnings.length) {
    lines.push("");
    answer.warnings.forEach((w) => lines.push(`⚠️ ${w}`));
  }

  return lines.join("\n").trim();
}

module.exports = { toText, helpText };
