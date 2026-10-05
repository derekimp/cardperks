/**
 * Where each issuer's offers come from.
 *
 * Adding a source is one entry here. `wordpress` reads every post under a
 * tag via the WordPress REST API (falling back to the tag's RSS feed);
 * `awardwallet` and `cardsandpoints` parse a single roundup page.
 */

module.exports = {
  amex: {
    issuerName: "American Express",
    prefix: /\b(?:am(?:erican\s*)?ex(?:press)?)\s*offers?\b\s*[:\-–—]?\s*/i,
    howTo: "Add the offer to your Amex card before purchase.",
    terms: "Enrollment required. Targeted offer — may not appear for all cardholders.",
    sources: [
      { type: "wordpress", name: "Doctor of Credit", site: "https://www.doctorofcredit.com", tag: "amex-offers" },
      { type: "awardwallet", name: "AwardWallet", url: "https://awardwallet.com/news/amex-membership-rewards/amex-offers/" },
    ],
  },
  chase: {
    issuerName: "Chase",
    prefix: /\bchase\s*offers?\b\s*[:\-–—]?\s*/i,
    howTo: "Activate the offer in your Chase account before purchase.",
    terms: "Activation required. Targeted offer — may not appear for all cardholders.",
    sources: [
      { type: "wordpress", name: "Doctor of Credit", site: "https://www.doctorofcredit.com", tag: "chase-offers" },
      { type: "awardwallet", name: "AwardWallet", url: "https://awardwallet.com/news/chase-ultimate-rewards/chase-offers/" },
    ],
  },
  bofa: {
    issuerName: "Bank of America",
    prefix: /\b(?:bank\s*of\s*america|bofa|bankamerideals?)\b(?:\s*deals?)?\s*[:\-–—]?\s*/i,
    howTo: "BankAmeriDeals offer — add it to your BofA card.",
    terms: "BankAmeriDeals offer. One-time use. Targeted offer.",
    sources: [
      { type: "wordpress", name: "Doctor of Credit", site: "https://www.doctorofcredit.com", tag: "bank-of-america-deals" },
      { type: "cardsandpoints", name: "Cards & Points", url: "https://www.cardsandpoints.com/bankamerideals/" },
    ],
  },
};
