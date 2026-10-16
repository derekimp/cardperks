/** HTML → plain text helpers shared by every source adapter. */

const cheerio = require("cheerio");

/** Decodes entities in a short string such as a rendered WordPress title. */
function decodeEntities(str) {
  return cheerio.load(`<p>${String(str || "")}</p>`)("p").text();
}

/** Strips tags and collapses whitespace, keeping block boundaries as spaces. */
function htmlToText(html) {
  const $ = cheerio.load(String(html || ""));
  $("script, style, noscript").remove();
  $("br, p, li, h1, h2, h3, h4, h5, h6, div, tr").each((_, el) => {
    $(el).append(" ");
  });
  return $.root().text().replace(/\s+/g, " ").trim();
}

module.exports = { decodeEntities, htmlToText };
