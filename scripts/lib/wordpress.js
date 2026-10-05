/**
 * Reads every post under a tag from a WordPress site.
 *
 * Doctor of Credit and most deal blogs run WordPress, which serves posts as
 * JSON at /wp-json/wp/v2/posts. That is stable across theme changes (the old
 * HTML selectors were not) and paginates, where the old scraper only ever
 * saw the first page of ~10 titles. The tag RSS feed is the fallback for
 * sites that disable the REST API.
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

async function viaRest(http, { site, tag, since, maxPages }) {
  const tagRes = await http.get(
    `${site}/wp-json/wp/v2/tags?slug=${encodeURIComponent(tag)}&_fields=id`,
    { accept: "application/json" }
  );
  const tags = JSON.parse(tagRes.body);
  if (!Array.isArray(tags) || !tags.length) throw new Error(`tag "${tag}" not found`);

  const posts = [];
  for (let page = 1; page <= maxPages; page++) {
    const url =
      `${site}/wp-json/wp/v2/posts?tags=${tags[0].id}&per_page=${PER_PAGE}&page=${page}` +
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

async function viaRss(http, { site, tag, since, maxPages }) {
  const posts = [];
  // RSS pages are short (usually 10 items), so allow more of them.
  for (let page = 1; page <= maxPages * 5; page++) {
    const url = `${site}/tag/${encodeURIComponent(tag)}/feed/${page > 1 ? `?paged=${page}` : ""}`;
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
 * @returns {Promise<{via: "rest"|"rss", posts: Array<{title, link, date: Date, text}>}>}
 */
async function fetchTaggedPosts(http, { site, tag, since, maxPages = 3 }) {
  try {
    return { via: "rest", posts: await viaRest(http, { site, tag, since, maxPages }) };
  } catch (restErr) {
    try {
      return { via: "rss", posts: await viaRss(http, { site, tag, since, maxPages }) };
    } catch (rssErr) {
      throw new Error(`REST failed (${restErr.message}); RSS failed (${rssErr.message})`);
    }
  }
}

module.exports = { fetchTaggedPosts };
