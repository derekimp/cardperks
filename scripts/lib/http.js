/**
 * Small HTTP client for the scrapers: timeouts, polite spacing between
 * requests, and retries on rate limits and server errors only.
 *
 * Every scraper takes the client as a parameter, so tests pass a stub and
 * never touch the network.
 */

// An honest bot UA. The WordPress REST and RSS endpoints this targets exist
// for programmatic readers, so there is no reason to pose as a browser.
const USER_AGENT = "CardPerksBot/1.0 (+https://github.com/derekimp/cardperks)";

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

class HttpError extends Error {
  /** `body` is excerpted into the message so a block page explains itself in CI logs. */
  constructor(url, status, body = "") {
    const excerpt = String(body).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    super(`HTTP ${status} for ${url}${excerpt ? ` — "${excerpt}"` : ""}`);
    this.status = status;
    this.url = url;
  }
}

/**
 * @returns {{ get(url: string, opts?: {accept?: string}): Promise<{status: number, headers: {get(name: string): string|null}, body: string}> }}
 */
function createHttp({
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  retries = 2,
  delayMs = 750,
  retryBaseMs = 1500,
} = {}) {
  let lastRequestAt = 0;

  async function get(url, { accept = "text/html,application/xhtml+xml" } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      await sleep(lastRequestAt + delayMs - Date.now());
      lastRequestAt = Date.now();

      try {
        const res = await fetchImpl(url, {
          headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "en-US,en;q=0.9" },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "follow",
        });
        const body = await res.text();

        if (res.status === 429 || res.status >= 500) {
          lastError = new HttpError(url, res.status, body);
          await sleep(retryBaseMs * 2 ** attempt);
          continue;
        }
        // Client errors are permanent; retrying a 403 or 404 only adds load.
        if (res.status < 200 || res.status >= 300) throw new HttpError(url, res.status, body);

        return { status: res.status, headers: res.headers, body };
      } catch (err) {
        if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
        lastError = err;
        await sleep(retryBaseMs * 2 ** attempt);
      }
    }

    throw lastError;
  }

  return { get };
}

module.exports = { createHttp, HttpError, USER_AGENT };
