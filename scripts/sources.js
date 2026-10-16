/**
 * Where each issuer's offers come from.
 *
 * Adding a source is one entry here. `wordpress` reads a WordPress blog,
 * either every post under a `tag` or every post matching a `search` (search
 * results are kept only when the title matches the issuer's `titleFilter`,
 * or its `prefix` when there is none); `awardwallet` and `cardsandpoints`
 * parse a single roundup page.
 *
 * `required` issuers fail the run when they come back empty. The others are
 * newer and sparsely covered by the blogs, so an empty day is normal for them.
 */

// Deal blogs that post one article per card-linked offer.
const BLOGS = [
  { name: "Doctor of Credit", site: "https://www.doctorofcredit.com" },
  { name: "Danny the Deal Guru", site: "https://www.dannydealguru.com" },
  { name: "Miles to Memories", site: "https://milestomemories.com" },
  { name: "Frequent Miler", site: "https://frequentmiler.com" },
];

/** One search source per blog, skipping blogs the issuer already reads by tag. */
function searchBlogs(search, { except = [] } = {}) {
  return BLOGS.filter((b) => !except.includes(b.name)).map((b) => ({
    type: "wordpress",
    name: `${b.name} (search)`,
    site: b.site,
    search,
  }));
}

module.exports = {
  amex: {
    issuerName: "American Express",
    required: true,
    prefix: /\b(?:am(?:erican\s*)?ex(?:press)?)\s*offers?\b\s*[:\-–—]?\s*/i,
    howTo: "Add the offer to your Amex card before purchase.",
    terms: "Enrollment required. Targeted offer — may not appear for all cardholders.",
    sources: [
      { type: "wordpress", name: "Doctor of Credit", site: "https://www.doctorofcredit.com", tag: "amex-offers" },
      { type: "awardwallet", name: "AwardWallet", url: "https://awardwallet.com/news/amex-membership-rewards/amex-offers/" },
      ...searchBlogs("amex offer", { except: ["Doctor of Credit"] }),
    ],
  },
  chase: {
    issuerName: "Chase",
    required: true,
    prefix: /\bchase\s*offers?\b\s*[:\-–—]?\s*/i,
    howTo: "Activate the offer in your Chase account before purchase.",
    terms: "Activation required. Targeted offer — may not appear for all cardholders.",
    sources: [
      { type: "wordpress", name: "Doctor of Credit", site: "https://www.doctorofcredit.com", tag: "chase-offers" },
      { type: "awardwallet", name: "AwardWallet", url: "https://awardwallet.com/news/chase-ultimate-rewards/chase-offers/" },
      ...searchBlogs("chase offer", { except: ["Doctor of Credit"] }),
    ],
  },
  bofa: {
    issuerName: "Bank of America",
    required: true,
    prefix: /\b(?:bank\s*of\s*america|bofa|bankamerideals?)\b(?:\s*deals?)?\s*[:\-–—]?\s*/i,
    // Plain "Bank of America" titles are mostly card reviews and bonuses.
    titleFilter: /\b(?:bankamerideals?|(?:bank\s*of\s*america|bofa)\s*deals?)\b/i,
    howTo: "BankAmeriDeals offer — add it to your BofA card.",
    terms: "BankAmeriDeals offer. One-time use. Targeted offer.",
    sources: [
      { type: "wordpress", name: "Doctor of Credit", site: "https://www.doctorofcredit.com", tag: "bank-of-america-deals" },
      { type: "cardsandpoints", name: "Cards & Points", url: "https://www.cardsandpoints.com/bankamerideals/" },
      ...searchBlogs("bankamerideals", { except: ["Doctor of Credit"] }),
    ],
  },
  citi: {
    issuerName: "Citi",
    prefix: /\bciti(?:bank)?\s*(?:merchant\s*)?offers?\b\s*[:\-–—]?\s*/i,
    howTo: "Enroll in the Citi Merchant Offer in your Citi account before purchase.",
    terms: "Enrollment required. Targeted offer — may not appear for all cardholders.",
    sources: searchBlogs("citi merchant offers"),
  },
  capone: {
    issuerName: "Capital One",
    prefix: /\bcapital\s*one\s*offers?\b\s*[:\-–—]?\s*/i,
    howTo: "Activate the offer in Capital One Offers before purchase.",
    terms: "Activation required. Targeted offer — may not appear for all cardholders.",
    sources: searchBlogs("capital one offers"),
  },
  usbank: {
    issuerName: "US Bank",
    prefix: /\bu\.?\s?s\.?\s*bank\s*(?:shoprewards|real[-\s]?time\s*rewards|deals?|offers?)\b\s*[:\-–—]?\s*/i,
    howTo: "Add the deal to your U.S. Bank card before purchase.",
    terms: "Activation required. Targeted offer — may not appear for all cardholders.",
    sources: searchBlogs("u.s. bank deals"),
  },
  wells: {
    issuerName: "Wells Fargo",
    prefix: /\bwells\s*fargo\s*deals?\b\s*[:\-–—]?\s*/i,
    howTo: "Activate the deal in Wells Fargo Deals before purchase.",
    terms: "Activation required. Targeted offer — may not appear for all cardholders.",
    sources: searchBlogs("wells fargo deals"),
  },
};
