/**
 * Pulls an offer's real end date out of a post.
 *
 * The old scrapers stamped every offer with a hardcoded "2026-06-30", so the
 * whole catalogue expired on the same day. Here a date is only accepted when
 * it follows an expiry-like word ("expires", "valid through", "by", …) and
 * lands in a plausible window around the post date. Anything else falls back
 * to an *estimated* expiry that the site and the bot label as unconfirmed.
 */

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const KEYWORD =
  "(?:expir(?:es|ation|y|ing|e)?(?:\\s+date)?|valid\\s+(?:through|thru|until|till)|(?:offer\\s+|deal\\s+)?ends?|end\\s+date|deadline|through|thru|until|till|by)";
const NUMERIC_DATE = "(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2}|\\d{4}))?";
const NAMED_DATE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?";

const EXPIRY_RE = new RegExp(
  `\\b${KEYWORD}\\s*(?:on\\s+)?[:\\-–—]?\\s*(?:${NUMERIC_DATE}|${NAMED_DATE})(?![\\d/])`,
  "gi"
);

// An offer that "expires" before it was posted, or more than ~13 months
// later, is a misparse (a post year, a phone number, an unrelated deadline).
const MAX_DAYS_BEFORE_POST = 1;
const MAX_DAYS_AFTER_POST = 400;
const DAY_MS = 86400000;

function utcDate(year, month, day) {
  const d = new Date(Date.UTC(year, month, day));
  // Reject rollovers such as Feb 30 → Mar 2.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  return d;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function normaliseYear(raw) {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return raw.length === 2 ? 2000 + n : n;
}

/** A year-less date belongs to the first occurrence on or after the post. */
function inferYear(month, day, postedAt) {
  const sameYear = utcDate(postedAt.getUTCFullYear(), month, day);
  if (sameYear && sameYear >= addDays(postedAt, -30)) return sameYear;
  return utcDate(postedAt.getUTCFullYear() + 1, month, day);
}

function plausible(date, postedAt) {
  return (
    date >= addDays(postedAt, -MAX_DAYS_BEFORE_POST) &&
    date <= addDays(postedAt, MAX_DAYS_AFTER_POST)
  );
}

/**
 * @param {string} text   title + body of the post, as plain text
 * @param {Date} postedAt when the post was published
 * @returns {string|null} YYYY-MM-DD, the latest plausible deadline found
 */
function parseExpiry(text, postedAt) {
  const found = [];
  EXPIRY_RE.lastIndex = 0;

  let m;
  while ((m = EXPIRY_RE.exec(String(text || "")))) {
    let date = null;
    if (m[1]) {
      const month = parseInt(m[1], 10) - 1;
      const day = parseInt(m[2], 10);
      const year = normaliseYear(m[3]);
      date = year ? utcDate(year, month, day) : inferYear(month, day, postedAt);
    } else if (m[4]) {
      const month = MONTHS[m[4].slice(0, 3).toLowerCase()];
      const day = parseInt(m[5], 10);
      const year = normaliseYear(m[6]);
      date = year ? utcDate(year, month, day) : inferYear(month, day, postedAt);
    }
    if (date && plausible(date, postedAt)) found.push(date);
  }

  if (!found.length) return null;
  // Posts often list several deadlines ("enroll by 10/15, spend by 11/30");
  // the offer stays usable until the last of them.
  found.sort((a, b) => b - a);
  return isoDate(found[0]);
}

module.exports = { parseExpiry, isoDate, addDays, DAY_MS };
