/**
 * Run with: npm test   (node --test)
 *
 * The fixtures in test/fixtures/data hold a live Uniqlo offer and one expired
 * offer, so these cover the paths the real data cannot currently exercise.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { loadOffers } = require("../lib/offers");
const { loadCatalog, selectCards, rankCards } = require("../lib/cards");
const { resolve } = require("../lib/merchants");
const { ask } = require("../lib/engine");
const { toText } = require("../lib/format");

const dataDir = path.join(__dirname, "fixtures", "data");
const NOW = new Date("2026-09-18T12:00:00Z");
const opts = { now: NOW, dataDir };

test("merchant aliases resolve to a merchant and category", () => {
  const r = resolve("what card should I use for this uniqlo shopping", { dataDir });
  assert.equal(r.merchant, "Uniqlo");
  assert.equal(r.category, "shopping");
  assert.equal(r.matchedBy, "alias");
});

test("longer aliases win over their own substrings", () => {
  assert.equal(resolve("ordering uber eats tonight", { dataDir }).merchant, "Uber Eats");
  assert.equal(resolve("taking an uber home", { dataDir }).merchant, "Uber");
});

test("aliases match whole tokens only", () => {
  // "targeted" must not match the merchant "Target".
  assert.equal(resolve("any targeted promos", { dataDir }).merchant, null);
});

test("category keywords resolve when no merchant is named", () => {
  const r = resolve("booking a flight next week", { dataDir });
  assert.equal(r.merchant, null);
  assert.equal(r.category, "travel");
  assert.equal(r.matchedBy, "keyword");
});

test("channel is detected when stated", () => {
  assert.equal(resolve("uniqlo online order", { dataDir }).channel, "online");
  assert.equal(resolve("buying at the store", { dataDir }).channel, "in-store");
  assert.equal(resolve("uniqlo", { dataDir }).channel, null);
});

test("expired offers are dropped and freshness is reported", () => {
  const { offers, expiredCount, lastUpdated, staleDays } = loadOffers(opts);
  assert.equal(offers.length, 3);
  assert.equal(expiredCount, 1);
  assert.equal(lastUpdated, "2026-09-15");
  assert.equal(staleDays, 3);
  assert.ok(!offers.some((o) => o.merchant === "Old Expired Store"));
});

test("a malformed or missing feed degrades instead of throwing", () => {
  const result = loadOffers({ now: NOW, dataDir: path.join(__dirname, "fixtures", "nonexistent") });
  assert.deepEqual(result.offers, []);
  assert.ok(result.issuers.amex.error);
});

test("rotating categories only count inside their window", () => {
  const { catalog } = loadCatalog({ dataDir });
  const { cards } = selectCards(catalog, { cards: [] });

  const inWindow = rankCards(cards, "shopping", {
    channel: null, now: NOW, valuations: catalog.valuations,
  });
  assert.equal(inWindow[0].cardName, "Rotator Card");
  assert.equal(inWindow[0].rate, 5);

  const afterWindow = rankCards(cards, "shopping", {
    channel: null, now: new Date("2026-10-15"), valuations: catalog.valuations,
  });
  assert.equal(afterWindow[0].cardName, "Rotator Card");
  assert.equal(afterWindow[0].rate, 3, "falls back to the online rate once the quarter ends");
});

test("in-store questions exclude online-only rates", () => {
  const { catalog } = loadCatalog({ dataDir });
  const { cards } = selectCards(catalog, { cards: [] });
  const ranked = rankCards(cards, "shopping", {
    channel: "in-store", now: new Date("2026-10-15"), valuations: catalog.valuations,
  });
  const rotator = ranked.find((c) => c.cardId === "rotator");
  assert.equal(rotator.rate, 1, "only the base rate survives in store");
  assert.equal(ranked[0].cardName, "Flat Two Cash");
});

test("point currencies are compared in effective percent", () => {
  const { catalog } = loadCatalog({ dataDir });
  const { cards } = selectCards(catalog, { cards: [] });
  const ranked = rankCards(cards, "shopping", {
    channel: null, now: NOW, valuations: catalog.valuations,
  });
  // 5x at 1.25 cents = 6.25% effective, ahead of the flat 2% cash card.
  assert.equal(ranked[0].effective, 6.25);
  assert.equal(ranked[1].effective, 2);
});

test("a wallet narrows the ranking to cards you hold", () => {
  const { catalog } = loadCatalog({ dataDir });
  const held = selectCards(catalog, { cards: ["flat-two"] });
  assert.equal(held.usingWallet, true);
  assert.equal(held.cards.length, 1);

  const empty = selectCards(catalog, { cards: [] });
  assert.equal(empty.usingWallet, false);
  assert.equal(empty.cards.length, 2);

  // An unknown id must not silently produce an empty ranking.
  const bogus = selectCards(catalog, { cards: ["no-such-card"] });
  assert.equal(bogus.usingWallet, false);
  assert.equal(bogus.cards.length, 2);
});

test("a merchant with a live offer leads with that offer", () => {
  const answer = ask("what card should I use for this uniqlo shopping", opts);
  assert.equal(answer.intent, "recommend");
  assert.equal(answer.merchant, "Uniqlo");
  assert.equal(answer.offers.length, 1);
  assert.equal(answer.offers[0].value, "$20 back on $100+");
  assert.equal(answer.warnings.length, 0, "fresh fixture data warns about nothing");

  const text = toText(answer);
  assert.match(text, /Uniqlo · shopping/);
  assert.match(text, /\$20 back on \$100\+/);
  assert.match(text, /Best cards for shopping/);
});

test("a merchant with no offer still gets a card recommendation", () => {
  const answer = ask("what card for ikea", opts);
  assert.equal(answer.merchant, "IKEA");
  assert.equal(answer.offers.length, 0);
  assert.ok(answer.cards.length > 0);
  assert.match(toText(answer), /No live targeted offer for IKEA/);
});

test("other offers in the same category are surfaced", () => {
  const answer = ask("what card for ikea", opts);
  assert.equal(answer.category, "home");
  assert.deepEqual(answer.categoryOffers, [], "no home-category offers in the fixture");

  // Nike has no offer of its own, so both shopping offers show as alternatives,
  // highest value first.
  const shopping = ask("what card for nike", opts);
  assert.equal(shopping.categoryOffers.length, 2);
  assert.deepEqual(
    shopping.categoryOffers.map((o) => o.merchant),
    ["Uniqlo", "Zara"]
  );

  // An offer for the merchant itself is not repeated in the alternatives.
  const uniqlo = ask("what card for uniqlo", opts);
  assert.deepEqual(uniqlo.categoryOffers.map((o) => o.merchant), ["Zara"]);
});

test("browse questions list the best live offers", () => {
  const answer = ask("what perks are around", opts);
  assert.equal(answer.intent, "browse");
  assert.equal(answer.totalLive, 3);
  assert.equal(answer.offers[0].merchant, "Uniqlo", "sorted by value");
  assert.match(toText(answer), /Top offers right now \(3 live\)/);
});

test("unrecognised questions get usage help, not a wrong answer", () => {
  const answer = ask("hey what's up", opts);
  assert.equal(answer.intent, "help");
  assert.match(toText(answer), /ask me what to pay with/i);
});

test("stale offer data is called out in the reply", () => {
  const answer = ask("what card for uniqlo", { now: new Date("2027-01-15"), dataDir });
  assert.ok(answer.warnings.some((w) => /days old/.test(w)));
  assert.match(toText(answer), /⚠️/);
});
