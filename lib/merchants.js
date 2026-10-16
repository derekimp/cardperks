/**
 * Turns a plain-English question into a merchant, a spend category and a
 * purchase channel. No model call — just alias and keyword matching against
 * data/merchants.json, which is what keeps replies instant.
 *
 * The file is re-read per question rather than cached, so adding a merchant
 * takes effect without restarting a long-running adapter.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function loadMerchants({ dataDir = DATA_DIR } = {}) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, "merchants.json"), "utf8"));
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-token match, so "target" does not fire on "targeted" and "uber" does
 * not fire inside "uber eats" once the longer alias has had its turn.
 */
function containsToken(haystack, needle) {
  const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`, "i");
  return re.test(haystack);
}

/** Longest alias first, so multi-word merchants beat their own substrings. */
function buildAliasIndex(merchants) {
  const entries = [];
  for (const m of merchants) {
    for (const alias of m.aliases || []) {
      entries.push({ alias: normalize(alias), merchant: m });
    }
  }
  entries.sort((a, b) => b.alias.length - a.alias.length);
  return entries;
}

function detectChannel(text, channelKeywords) {
  const pairs = [];
  for (const [channel, words] of Object.entries(channelKeywords || {})) {
    for (const word of words) pairs.push({ channel, word: normalize(word) });
  }
  pairs.sort((a, b) => b.word.length - a.word.length);
  for (const { channel, word } of pairs) {
    if (containsToken(text, word)) return channel;
  }
  return null;
}

function detectCategory(text, categoryKeywords) {
  const pairs = [];
  for (const [category, words] of Object.entries(categoryKeywords || {})) {
    for (const word of words) pairs.push({ category, word: normalize(word) });
  }
  pairs.sort((a, b) => b.word.length - a.word.length);
  for (const { category, word } of pairs) {
    if (containsToken(text, word)) return { category, keyword: word };
  }
  return null;
}

/**
 * @returns {{merchant: string|null, category: string|null,
 *            matchedBy: "alias"|"keyword"|"none", channel: string|null,
 *            aliasHit: string|null}}
 */
function resolve(question, { data = null, dataDir = DATA_DIR } = {}) {
  const db = data || loadMerchants({ dataDir });
  const text = normalize(question);
  const channel = detectChannel(text, db.channelKeywords);

  for (const { alias, merchant } of buildAliasIndex(db.merchants || [])) {
    if (containsToken(text, alias)) {
      return {
        merchant: merchant.name,
        category: merchant.category,
        matchedBy: "alias",
        aliasHit: alias,
        channel,
      };
    }
  }

  const byKeyword = detectCategory(text, db.categoryKeywords);
  if (byKeyword) {
    return {
      merchant: null,
      category: byKeyword.category,
      matchedBy: "keyword",
      aliasHit: byKeyword.keyword,
      channel,
    };
  }

  return { merchant: null, category: null, matchedBy: "none", aliasHit: null, channel };
}

module.exports = { loadMerchants, resolve, normalize, containsToken };
