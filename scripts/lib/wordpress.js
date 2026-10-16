/**
 * Reads posts from a WordPress site, either every post under a tag or every
 * post matching a search.
 *
 * Doctor of Credit and most deal blogs run WordPress, which serves posts as
 * JSON at /wp-json/wp/v2/posts. That is stable across theme changes (the old
 * HTML selectors were not) and paginates, where the old scraper only ever
 * saw the first page of ~10 titles. The tag or search RSS feed is the
 * fallback for sites that disable the REST API.
 *
 * Search needs no knowledge of a blog's tag names, so it is how blogs other
 * than Doctor of Credit are read; it also matches posts that merely mention
 * the phrase, so callers filter search results by title.
 */

const cheerio = require("cheerio");
const { decodeEntities, htmlToText } = require("./text");

const PER_PAGE = 100; // WordPress's maximum

function toPost({ title, link, date, html }) {
  return {
    title: decodeEntities(title).trim(),
    link,
    date: new Date(date),
    text: htmlToText(html),
  };
}

/** The posts-endpoint filter: a tag id, or a search phrase. */
async function restFilter(http, { site, tag, search }) {
  if (search) return `search=${encodeURIComponent(search)}`;
  const tagRes = await http.get(
    `${site}/wp-json/wp/v2/tags?slug=${encodeURIComponent(tag)}&_fields=id`,
    { accept: "application/json" }
  );
  const tags = JSON.parse(tagRes.body);
  if (!Array.isArray(tags) || !tags.length) throw new Error(`tag "${tag}" not found`);
  return `tags=${tags[0].id}`;
}

async function viaRest(http, { site, tag, search, since, maxPages }) {
  const filter = await restFilter(http, { site, tag, search });

  const posts = [];
  for (let page = 1; page <= maxPages; page++) {
    const url =
      `${site}/wp-json/wp/v2/posts?${filter}&per_page=${PER_PAGE}&page=${page}` +
      `&after=${since.toISOString()}&_fields=date_gmt,link,title,content`;
    const res = await http.get(url, { accept: "application/json" });
    const batch = JSON.parse(res.body);
    if (!Array.isArray(batch)) throw new Error("unexpected posts payload");

    for (const p of batch) {
      posts.push(
        toPost({
          title: p.title && p.title.rendered,
          link: p.link,
          date: `${p.date_gmt}Z`,
          html: p.content && p.content.rendered,
        })
      );
    }

    // WordPress reports the page count; without it, a short page is the last.
    const totalPages = parseInt(res.headers.get("x-wp-totalpages"), 10);
    if (Number.isFinite(totalPages) ? page >= totalPages : batch.length < PER_PAGE) break;
  }
  return posts;
}

function rssUrl({ site, tag, search }, page) {
  if (search) return `${site}/?s=${encodeURIComponent(search)}&feed=rss2${page > 1 ? `&paged=${page}` : ""}`;
  return `${site}/tag/${encodeURIComponent(tag)}/feed/${page > 1 ? `?paged=${page}` : ""}`;
}

async function viaRss(http, { site, tag, search, since, maxPages }) {
  const posts = [];
  // RSS pages are short (usually 10 items), so allow more of them.
  for (let page = 1; page <= maxPages * 5; page++) {
    const url = rssUrl({ site, tag, search }, page);
    const res = await http.get(url, { accept: "application/rss+xml, application/xml, text/xml" });
    const $ = cheerio.load(res.body, { xmlMode: true });
    const items = $("item").toArray();
    if (!items.length) break;

    let oldest = Infinity;
    for (const el of items) {
      const item = $(el);
      const post = toPost({
        title: item.find("title").first().text(),
        link: item.find("link").first().text().trim(),
        date: item.find("pubDate").first().text(),
        html: item.find("content\\:encoded").first().text() || item.find("description").first().text(),
      });
      oldest = Math.min(oldest, post.date.getTime());
      if (post.date >= since) posts.push(post);
    }
    if (oldest < since.getTime()) break;
  }
  return posts;
}

/**
 * @param {object} q  `site` plus either `tag` (a tag slug) or `search` (a phrase)
 * @returns {Promise<{via: "rest"|"rss", posts: Array<{title, link, date: Date, text}>}>}
 */
async function fetchPosts(http, { site, tag, search, since, maxPages = 3 }) {
  if (!tag === !search) throw new Error("give exactly one of tag or search");
  const q = { site, tag, search, since, maxPages };
  try {
    return { via: "rest", posts: await viaRest(http, q) };
  } catch (restErr) {
    try {
      return { via: "rss", posts: await viaRss(http, q) };
    } catch (rssErr) {
      throw new Error(`REST failed (${restErr.message}); RSS failed (${rssErr.message})`);
    }
  }
}

module.exports = { fetchPosts };
