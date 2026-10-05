/**
 * Scraper pipeline tests. Every source is stubbed from fixtures shaped like
 * real WordPress REST / RSS / roundup responses, so nothing touches the
 * network and the run is deterministic.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { createHttp, HttpError } = require("../scripts/lib/http");
const { parseExpiry } = require("../scripts/lib/dates");
const { parseOffer } = require("../scripts/lib/parse-offer");
const { fetchTaggedPosts } = require("../scripts/lib/wordpress");
const { scrapeIssuer, mergeOffers, decideWrite } = require("../scripts/lib/pipeline");
const { parseArgs } = require("../scripts/scrape");
const SOURCES = require("../scripts/sources");
const { toText } = require("../lib/format");

const FIX = path.join(__dirname, "fixtures", "scrape");
const fixture = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const NOW = new Date("2026-10-05T12:00:00Z");

/** Routes: [predicate, {body, headers} | Error]. Unmatched URLs 404. */
function stubHttp(routes) {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      for (const [match, res] of routes) {
        if (!match(url)) continue;
        if (res instanceof Error) throw res;
        const headers = res.headers || {};
        return { status: 200, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, body: res.body };
      }
      throw new HttpError(url, 404);
    },
  };
}

const wpRoutes = () => [
  [(u) => u.includes("/wp-json/wp/v2/tags"), { body: fixture("wp-tags.json") }],
  [(u) => u.includes("/wp/v2/posts") && u.includes("page=1&"), { body: fixture("wp-posts-page1.json"), headers: { "x-wp-totalpages": "2" } }],
  [(u) => u.includes("/wp/v2/posts") && u.includes("page=2&"), { body: fixture("wp-posts-page2.json"), headers: { "x-wp-totalpages": "2" } }],
];
const awRoute = [(u) => u.includes("awardwallet.com"), { body: fixture("awardwallet.html") }];

// ── Expiry parsing ──────────────────────────────────────────────────

test("expiry dates are read from expiry-like phrases", () => {
  const posted = new Date("2026-10-02T00:00:00Z");
  assert.equal(parseExpiry("Expires 12/31/2026", posted), "2026-12-31");
  assert.equal(parseExpiry("Expiration date 12/31/26", posted), "2026-12-31");
  assert.equal(parseExpiry("valid through November 30", posted), "2026-11-30");
  assert.equal(parseExpiry("Offer ends: Dec. 15th, 2026", posted), "2026-12-15");
});

test("the latest of several deadlines wins", () => {
  const posted = new Date("2026-10-02T00:00:00Z");
  assert.equal(parseExpiry("enroll by 10/15, spend by 11/30", posted), "2026-11-30");
});

test("year-less dates roll into the next year when needed", () => {
  assert.equal(parseExpiry("spend by 1/15", new Date("2026-12-20T00:00:00Z")), "2027-01-15");
});

test("implausible or invalid dates are rejected", () => {
  const posted = new Date("2026-10-02T00:00:00Z");
  assert.equal(parseExpiry("expires 1/1/2019", posted), null, "before the post");
  assert.equal(parseExpiry("expires 1/1/2030", posted), null, "years out");
  assert.equal(parseExpiry("expires 2/30/2027", posted), null, "no Feb 30");
  assert.equal(parseExpiry("call 555/1212 for details", posted), null, "no keyword");
  assert.equal(parseExpiry("", posted), null);
});

// ── Title parsing ───────────────────────────────────────────────────

test("the common deal-title shapes all parse", () => {
  const amex = SOURCES.amex.prefix;
  const cases = [
    ["AmEx Offers: Uniqlo, Spend $100 Get $20 Back", amex, "Uniqlo", "$20 back on $100+"],
    ["Amex Offer: Spend $50, Get $10 Back At Starbucks", amex, "Starbucks", "$10 back on $50+"],
    ["[Targeted] AmEx Offers: Get 20% Back On Dell (Up To $100)", amex, "Dell", "20% back (up to $100)"],
    ["AmEx Offers: Spend $250 at Lowe's, Get $50 Back", amex, "Lowe's", "$50 back on $250+"],
    ["Bank of America Deals: Starbucks $10 Off $20", SOURCES.bofa.prefix, "Starbucks", "$10 back on $20+"],
    ["Chase Offers: DISH Network, Spend $85 Get $85 Back (Limit 1)", SOURCES.chase.prefix, "DISH Network", "$85 back on $85+"],
  ];
  for (const [title, prefix, merchant, value] of cases) {
    const o = parseOffer({ title, prefix });
    assert.ok(o, `parsed: ${title}`);
    assert.equal(o.merchant, merchant, title);
    assert.equal(o.value, value, title);
  }
});

test("points offers are valued near cash so ranking stays sane", () => {
  const o = parseOffer({ title: "AmEx Offers: Shell, Get 5,000 Membership Rewards Points After Spending $50", prefix: SOURCES.amex.prefix });
  assert.equal(o.value, "5,000 points on $50+");
  assert.equal(o.valueNum, 50);
  assert.equal(o.category, "gas");
});

test("expired and non-offer posts are skipped", () => {
  const prefix = SOURCES.amex.prefix;
  assert.equal(parseOffer({ title: "[Expired] AmEx Offers: Zara, Spend $75 Get $15 Back", prefix }), null);
  assert.equal(parseOffer({ title: "Amex Platinum Review: Is It Worth It?", prefix }), null);
  assert.equal(parseOffer({ title: "AmEx Offers: Spend $50 Get $10 Back", prefix }), null, "no merchant to attribute");
});

// ── WordPress client ────────────────────────────────────────────────

test("REST client follows X-WP-TotalPages and decodes titles", async () => {
  const http = stubHttp(wpRoutes());
  const { via, posts } = await fetchTaggedPosts(http, {
    site: "https://www.doctorofcredit.com", tag: "amex-offers", since: new Date("2026-06-01T00:00:00Z"),
  });
  assert.equal(via, "rest");
  assert.equal(posts.length, 7, "six from page 1 plus one from page 2");
  assert.ok(posts.some((p) => p.title === "AmEx Offers: H&M, Get 10% Back (Up To $30)"), "&#038; decoded");
  assert.ok(http.calls.some((u) => u.includes("tags=4242")), "tag slug resolved to id");
  assert.equal(http.calls.filter((u) => u.includes("/posts")).length, 2, "stops at the last page");
});

test("RSS is used when the REST API is unavailable", async () => {
  const http = stubHttp([[(u) => u.includes("/tag/chase-offers/feed/") && !u.includes("paged"), { body: fixture("feed.xml") }]]);
  const { via, posts } = await fetchTaggedPosts(http, {
    site: "https://www.doctorofcredit.com", tag: "chase-offers", since: new Date("2026-06-01T00:00:00Z"),
  });
  assert.equal(via, "rss");
  assert.deepEqual(posts.map((p) => p.title), [
    "Chase Offers: DISH Network, Spend $85 Get $85 Back (Limit 1)",
    "Chase Offers: Shake Shack, Get 15% Back",
  ], "the post older than the window is dropped");
  assert.match(posts[0].text, /Deal ends 11\/30\/2026/, "content:encoded is read");
  assert.ok(!http.calls.some((u) => u.includes("paged=2")), "stops paging once posts predate the window");
});

test("a source failing both ways reports both errors", async () => {
  await assert.rejects(
    fetchTaggedPosts(stubHttp([]), { site: "https://x.example", tag: "t", since: NOW }),
    /REST failed .*RSS failed/
  );
});

// ── HTTP client ─────────────────────────────────────────────────────

test("http retries server errors but not client errors", async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    return calls < 3 ? new Response("busy", { status: 503 }) : new Response("ok", { status: 200 });
  };
  const http = createHttp({ fetchImpl: flaky, delayMs: 0, retryBaseMs: 0 });
  assert.equal((await http.get("https://x.example")).body, "ok");
  assert.equal(calls, 3);

  calls = 0;
  const forbidden = async () => { calls++; return new Response("no", { status: 403 }); };
  const http403 = createHttp({ fetchImpl: forbidden, delayMs: 0, retryBaseMs: 0 });
  await assert.rejects(http403.get("https://x.example"), /HTTP 403/);
  assert.equal(calls, 1, "a 403 is not retried");
});

// ── Pipeline ────────────────────────────────────────────────────────

test("the amex pipeline merges, dates and filters offers", async () => {
  const http = stubHttp([...wpRoutes(), awRoute]);
  const { offers, stats, allSourcesFailed } = await scrapeIssuer(http, "amex", SOURCES.amex, { now: NOW });

  assert.equal(allSourcesFailed, false);
  assert.deepEqual(stats.map((s) => [s.name, s.via, s.error]), [
    ["Doctor of Credit", "rest", null],
    ["AwardWallet", "page", null],
  ]);

  const byMerchant = Object.fromEntries(offers.map((o) => [o.merchant, o]));
  assert.deepEqual(Object.keys(byMerchant).sort(), ["Dell", "H&M", "Marriott Bonvoy", "Starbucks", "Uniqlo"]);

  // Two Uniqlo posts, both with stated expiries: the newer one wins.
  assert.equal(byMerchant.Uniqlo.value, "$20 back on $100+");
  assert.equal(byMerchant.Uniqlo.expiry, "2026-12-31");
  assert.equal(byMerchant.Uniqlo.expiryEstimated, false);
  assert.equal(byMerchant.Uniqlo.isNew, true);

  // No stated end date: 30 days from the post, flagged as an estimate.
  assert.equal(byMerchant["H&M"].expiry, "2026-10-01");
  assert.equal(byMerchant["H&M"].expiryEstimated, true);
  assert.equal(byMerchant["H&M"].id, "amex-h-and-m");

  assert.equal(byMerchant.Starbucks.expiry, "2026-11-30", "year inferred from the post");
  assert.equal(byMerchant.Dell.expiry, "2026-11-15", "roundup item dated from its own text");
  assert.equal(byMerchant["Marriott Bonvoy"].value, "+5 pts/$ (up to $75)");
  assert.equal(byMerchant["Marriott Bonvoy"].category, "travel");

  assert.ok(!byMerchant["Old Store"], "estimated expiry long past is dropped");
  assert.ok(!byMerchant.Zara, "[Expired] post is skipped");
  assert.ok(offers.every((o) => o.id && o.terms && o.sourceUrl), "every offer is complete");
  assert.deepEqual(offers.map((o) => o.postedAt), [...offers.map((o) => o.postedAt)].sort().reverse(), "newest first");
});

test("one failing source does not sink the others", async () => {
  const http = stubHttp([awRoute]); // Doctor of Credit 404s on REST and RSS
  const { offers, stats, allSourcesFailed } = await scrapeIssuer(http, "amex", SOURCES.amex, { now: NOW });
  assert.equal(allSourcesFailed, false);
  assert.match(stats[0].error, /REST failed/);
  assert.deepEqual(offers.map((o) => o.merchant).sort(), ["Dell", "Marriott Bonvoy"]);
});

test("every source failing yields no offers and says so", async () => {
  const { offers, allSourcesFailed } = await scrapeIssuer(stubHttp([]), "amex", SOURCES.amex, { now: NOW });
  assert.equal(allSourcesFailed, true);
  assert.deepEqual(offers, []);
});

test("merge prefers a confirmed expiry over a newer estimate", () => {
  const estimated = { merchant: "Nike", postedAt: "2026-10-04", expiryEstimated: true, valueNum: 50 };
  const confirmed = { merchant: "Nike", postedAt: "2026-09-01", expiryEstimated: false, valueNum: 10 };
  assert.equal(mergeOffers([estimated, confirmed])[0], confirmed);
  assert.equal(mergeOffers([confirmed, estimated])[0], confirmed);
});

// ── Write decisions and CLI ─────────────────────────────────────────

test("an empty result never overwrites the data file", () => {
  assert.equal(decideWrite([{ id: "a" }], []), "empty");
  assert.equal(decideWrite([{ id: "a" }], [{ id: "a" }]), "unchanged");
  assert.equal(decideWrite([{ id: "a" }], [{ id: "b" }]), "write");
  assert.equal(decideWrite(undefined, [{ id: "b" }]), "write");
});

test("CLI arguments parse", () => {
  assert.deepEqual(parseArgs(["--issuer", "chase,bofa"]).issuers, ["chase", "bofa"]);
  assert.deepEqual(parseArgs(["--all"]).issuers, ["amex", "chase", "bofa"]);
  assert.equal(parseArgs(["--all", "--dry-run"]).dryRun, true);
  assert.equal(parseArgs(["--all", "--max-pages", "5"]).maxPages, 5);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
});

test("the bot calls an estimated expiry unconfirmed", () => {
  const text = toText({
    intent: "browse",
    totalLive: 1,
    offers: [{ merchant: "H&M", value: "10% back", issuerName: "American Express", expiry: "2026-10-01", expiryEstimated: true }],
    warnings: [],
  });
  assert.match(text, /expiry unconfirmed/);
  assert.doesNotMatch(text, /expires 2026-10-01/);
});

test("a post with an unreadable date is skipped, not fatal", async () => {
  const posts = JSON.parse(fixture("wp-posts-page1.json"));
  posts[0].date_gmt = "not-a-date";
  const http = stubHttp([
    [(u) => u.includes("/wp-json/wp/v2/tags"), { body: fixture("wp-tags.json") }],
    [(u) => u.includes("/wp/v2/posts"), { body: JSON.stringify(posts), headers: { "x-wp-totalpages": "1" } }],
  ]);
  const { offers, stats } = await scrapeIssuer(http, "amex", { ...SOURCES.amex, sources: [SOURCES.amex.sources[0]] }, { now: NOW });
  assert.equal(stats[0].error, null);
  assert.ok(offers.length > 0, "the rest of the source still counts");
});
