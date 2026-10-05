# CardPerks assistant

Ask by text message which card to pull out.

```
you →  what card should I use for this uniqlo shopping?
bot ←  Uniqlo · shopping

       Targeted offer on your account list:
       • Uniqlo: $20 back on $100+ [American Express] — expires 2026-12-31

       Best card in your wallet for shopping:
       1. Chase Freedom Flex — 5x (~6.3% value)
          5% rotating category this quarter — activation required · cap $1,500/quarter
       2. Citi Double Cash — 2% back
       3. Amex Gold — 1x (~1.3% value)

       Also live in shopping:
       • Zara: 10% back [American Express] — expires 2026-12-31
```

That example uses a wallet of three cards and a live Uniqlo offer. With the
offer data as it stands today the reply keeps the card ranking and says plainly
that no targeted offer was found — see the limitation at the end.

## Why there is no model call on the hot path

Asking Claude directly gets you general knowledge about credit cards. It does
not know which targeted offers landed on *your* accounts this week, or which
cards you carry. That data is what this project already collects, so the
assistant is a lookup, not an inference:

- **Instant** — a reply is a few JSON reads, a few milliseconds.
- **Free** — no API key, no per-message cost.
- **Predictable** — the same question always gives the same answer, and it can
  only say what is in `data/`.

The cost is phrasing sensitivity: a merchant nobody has added to
`data/merchants.json` falls back to a category guess, and unusual wording may
land on the help text. Adding a line to `merchants.json` is the fix, and it is
cheaper than an inference call. If open-ended questions ever matter more than
latency, `lib/engine.js` is the one place a model fallback would go — when
`intent` comes back `help`, hand the raw question plus the offer list to a
model instead of returning usage text.

## Layout

```
lib/engine.js      ask(question) -> structured answer   ← all the logic
lib/format.js      answer -> plain text for a chat thread
lib/merchants.js   question -> merchant, category, channel
lib/cards.js       category -> ranked cards by effective value
lib/offers.js      loads scraped offers, drops expired, reports staleness

bin/ask.js         CLI, for testing without a phone
api/ask.js         HTTP endpoint (Vercel function), for webhook channels
adapters/          one file per messaging channel
```

The contract every channel shares is two calls:

```js
const { ask } = require("./lib/engine");
const { toText } = require("./lib/format");

const reply = toText(ask("what card for uniqlo?"));
```

Nothing in `lib/` knows what a phone is, so a new channel is plumbing only.

## Running it

```bash
npm test                                   # 17 tests, no network needed
npm run ask "what card for uniqlo?"        # CLI
node bin/ask.js --json "any perks at trader joes"   # structured output
```

### iMessage (macOS)

Apple ships no iMessage API, so the free route is a Mac watching its own
Messages database:

1. Copy `adapters/imessage/config.example.json` to `config.json` and list the
   handles allowed to ask. Nothing outside that allowlist gets a reply, and the
   file is gitignored so your number stays out of the repo.
2. Grant **Full Disk Access** to your terminal (System Settings → Privacy &
   Security → Full Disk Access). Reading `~/Library/Messages/chat.db` fails
   without it.
3. `npm run imessage:dry` to log replies without sending, then `npm run imessage`.

Requires a Mac that stays awake and signed in to iMessage. First run records the
newest message id, so it never answers old threads retroactively. Replies are
rate limited per sender to keep a loop from running away.

### Other channels

WhatsApp, Telegram and Slack are all webhook-in / REST-out, which is a better
fit than iMessage: deploy `api/ask.js` and give each channel a small handler.
WhatsApp Cloud API, for instance:

```js
// api/webhook/whatsapp.js
const { ask } = require("../../lib/engine");
const { toText } = require("../../lib/format");

module.exports = async (req, res) => {
  if (req.method === "GET") {                      // one-time verification
    const ok = req.query["hub.verify_token"] === process.env.WA_VERIFY_TOKEN;
    return ok ? res.status(200).send(req.query["hub.challenge"]) : res.sendStatus(403);
  }

  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg?.text) {
    await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.from,
        text: { body: toText(ask(msg.text.body)) },
      }),
    });
  }
  res.sendStatus(200);  // acknowledge fast; Meta retries on delay
};
```

Verify the `X-Hub-Signature-256` header before trusting a payload, and keep an
allowlist of senders as the iMessage adapter does.

An iOS **Shortcut** is the no-server option: have it POST to `/api/ask` and drop
the reply into a Messages draft. You tap to run it — it cannot auto-reply.

## The data files

| File | What it holds |
| --- | --- |
| `data/cards.json` | Earn rates per card, plus cents-per-point valuations used to compare points against cash |
| `data/wallet.json` | The cards you carry. Empty ranks the whole catalog; fill it in and answers get shorter |
| `data/merchants.json` | Merchant aliases → category, plus category and channel keywords |
| `data/*-offers.json` | Scraper output, shared with the website |

Two things to know about the ranking:

- **Points are converted before comparison.** Amex MR and Chase UR default to
  1.25¢, a conservative transfer floor. Raise them in `cards.json` if you
  reliably do better, and the ranking shifts accordingly.
- **Caps are shown, not tracked.** The bot will happily recommend a 5% rotating
  category it cannot know you have already maxed out.

Rates are hand-entered and drift as issuers change their products — treat a
recommendation as a prompt to check, not gospel.

## Where the offer data comes from

`data/*-offers.json` is refreshed daily by `.github/workflows/refresh-offers.yml`;
see [`docs/SCRAPING.md`](SCRAPING.md). Offers whose source gave no end date carry
`expiryEstimated: true`, and the bot says "expiry unconfirmed" for those rather
than quoting a guessed date.

Until that workflow has run once on `main`, the committed data is the old
snapshot whose offers all expired on 2026-06-30, so answers fall back to card
earn rates alone and say so:

```
⚠️ Offer data is 156 days old (last refreshed 2026-04-15) …
```
