/**
 * Single-page roundups that list many offers in one article. Ported from
 * the old scrapers, with the hardcoded expiry replaced by parsing each item.
 *
 * Each adapter returns raw items ({title, text, merchantHint}); the shared
 * offer parser turns them into offers.
 */

const cheerio = require("cheerio");

/** AwardWallet: one h2/h3 per offer, details in the paragraphs below it. */
function parseAwardWallet(html) {
  const $ = cheerio.load(html);
  const items = [];

  $("article .entry-content h2, article .entry-content h3").each((_, el) => {
    const heading = $(el).text().trim();
    if (!heading) return;

    let text = "";
    let next = $(el).next();
    while (next.length && !next.is("h2, h3")) {
      text += `${next.text().trim()} `;
      next = next.next();
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length < 20) return;

    items.push({
      title: `${heading} ${text}`,
      text,
      merchantHint: heading.replace(/[:\-–—].*$/, "").trim(),
    });
  });

  return items;
}

/** Cards & Points: one paragraph or list item per BankAmeriDeal. */
function parseCardsAndPoints(html) {
  const $ = cheerio.load(html);
  const items = [];

  $("article .entry-content p, article .entry-content li").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 10) return;

    const merchant = text.match(/^([A-Z][A-Za-z0-9\s&'.]+?)[\s:–—-]+\$?\d+%?/);
    if (!merchant) return;

    items.push({ title: text, text, merchantHint: merchant[1].trim() });
  });

  return items;
}

module.exports = { awardwallet: parseAwardWallet, cardsandpoints: parseCardsAndPoints };
