# Offer scraping

`node scripts/scrape.js --all` rebuilds `data/<issuer>-offers.json` for Amex,
Chase, Bank of America, Citi, Capital One, US Bank and Wells Fargo. A GitHub
Action runs it daily and commits any change.

```bash
npm run scrape:all                      # every issuer, writes data/
npm run scrape:amex:dry                 # one issuer, print JSON instead of writing
node scripts/scrape.js --issuer chase --max-pages 5 --window-days 90
```

## Sources

Configured in `scripts/sources.js`; adding one is a single entry.

| Type | Reads | Used for |
| --- | --- | --- |
| `wordpress` + `tag` | Every post under a tag via the WordPress REST API (`/wp-json/wp/v2/posts`), paginated, falling back to the tag's RSS feed | Doctor of Credit's `amex-offers`, `chase-offers`, `bank-of-america-deals` |
| `wordpress` + `search` | Every post matching a phrase, same API (RSS fallback: `/?s=…&feed=rss2`); only posts whose title names the issuer's offer program are kept | Danny the Deal Guru, Miles to Memories, Frequent Miler for every issuer; Doctor of Credit for the newer four |
| `awardwallet` | One roundup article, one heading per offer | AwardWallet's Amex and Chase roundups |
| `cardsandpoints` | One roundup article, one line per offer | Cards & Points' BankAmeriDeals list |

Search is how a blog gets added without knowing its tag names: a new
WordPress blog is one line in `BLOGS` in `scripts/sources.js`. Because a
search also returns card reviews and news that mention the phrase, results
pass through the issuer's `titleFilter` (or its `prefix`), so "Wells Fargo
Active Cash Review" is dropped while "Wells Fargo Deals: Chewy…" is kept.
Offers found by several blogs merge into one, so extra blogs add coverage
without adding duplicates.

The REST API is preferred over scraping HTML because it survives theme
changes and pages through history; the old scrapers saw only the ~10 titles
on a tag's first page. Requests identify as `CardPerksBot/1.0` and are spaced
out, with retries only on 429 and 5xx.

## How an offer is built

1. **Title → offer.** `scripts/lib/parse-offer.js` reads the merchant and value
   from titles like "AmEx Offers: Uniqlo, Spend $100 Get $20 Back" or
   "Get 20% Back On Dell (Up To $100)". `[Expired]` posts and posts with no
   recognisable value or merchant are skipped: a missing offer costs less
   than a wrong one.
2. **Category.** Looked up in `data/merchants.json`, the same map the text
   assistant uses, so the site and the bot agree.
3. **Expiry.** `scripts/lib/dates.js` takes the latest date that follows an
   expiry word ("expires", "valid through", "by", …) and falls within a year
   of the post. Year-less dates roll forward ("by 1/15" in December means
   next January). When a post states no end date, expiry is set 30 days after
   the post and the offer is marked `expiryEstimated: true`; the site shows
   "Expiry unconfirmed" instead of a date.
4. **Merge.** One offer per merchant per issuer: a stated expiry beats an
   estimate, then the newer post wins, then the larger reward.
5. **Filter.** Posts older than 120 days are not read; offers more than 7 days
   past expiry are dropped, matching the site's grace period.

Offer ids are stable slugs (`amex-uniqlo`), so links and diffs stay readable.

## Failure handling

- A source that fails is logged and skipped; the issuer's other sources
  still count.
- An issuer that ends up with **zero** offers keeps its existing file — a
  blocked or broken source never wipes the site. For the required issuers
  (Amex, Chase, BofA) the run then exits 1. Citi, Capital One, US Bank and
  Wells Fargo get far fewer posts, so an empty day is logged but not a
  failure; their data file appears the first time an offer is found, and the
  site and bot ignore it until then.
- In the workflow, issuers that succeeded are still committed; the job then
  goes red so a failing source gets noticed.
- If the offers did not change, the file is not rewritten, so a quiet day
  makes no commit (and no redeploy).
- HTTP errors include an excerpt of the response, so a block page such as a
  Cloudflare challenge is identifiable straight from the Actions log.

## Caveats

- **Targeted offers.** Blogs cover the notable offers, not every offer every
  cardholder sees. This pipeline makes the most of public sources; it cannot
  see into anyone's account.
- **Bot blocking.** Some sites block datacenter IP ranges, GitHub's runners
  included. If a source fails every day with a 403, the log excerpt will say
  why; the fix is a different source or running the scraper from elsewhere.
- **Branch protection.** The workflow pushes to `main` as
  `github-actions[bot]`. If `main` requires pull requests, allow that bot or
  change the workflow to open a PR instead.
