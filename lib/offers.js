/**
 * Loads the scraped targeted-offer files and reports how fresh they are.
 *
 * The grace period matches js/app.js so the messaging bot and the website
 * never disagree about which offers are still live.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const GRACE_DAYS = 7;

// Keep this list in sync with DATA_FILES in js/app.js.
const OFFER_FILES = [
  { file: "amex-offers.json", issuer: "amex" },
  { file: "chase-offers.json", issuer: "chase" },
  { file: "bofa-offers.json", issuer: "bofa" },
];

function daysBetween(later, earlier) {
  return Math.floor((later - earlier) / 86400000);
}

/**
 * @returns {{offers: Array, expiredCount: number, lastUpdated: string|null,
 *            staleDays: number|null, issuers: Object}}
 */
function loadOffers({ now = new Date(), dataDir = DATA_DIR } = {}) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - GRACE_DAYS);

  const offers = [];
  const issuers = {};
  let expiredCount = 0;
  const updateDates = [];

  for (const { file, issuer } of OFFER_FILES) {
    const full = path.join(dataDir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (err) {
      // A missing or malformed feed should degrade the answer, not break it.
      issuers[issuer] = { error: err.message };
      continue;
    }

    issuers[issuer] = {
      issuerName: parsed.issuerName,
      lastUpdated: parsed.lastUpdated,
      source: parsed.source,
      total: (parsed.offers || []).length,
    };
    if (parsed.lastUpdated) updateDates.push(parsed.lastUpdated);

    for (const offer of parsed.offers || []) {
      const live = new Date(offer.expiry) >= cutoff;
      if (!live) {
        expiredCount++;
        continue;
      }
      offers.push({ ...offer, issuer, issuerName: parsed.issuerName });
    }
  }

  updateDates.sort();
  const lastUpdated = updateDates.length ? updateDates[updateDates.length - 1] : null;

  return {
    offers,
    expiredCount,
    lastUpdated,
    staleDays: lastUpdated ? daysBetween(now, new Date(lastUpdated)) : null,
    issuers,
  };
}

module.exports = { loadOffers, GRACE_DAYS, OFFER_FILES };
