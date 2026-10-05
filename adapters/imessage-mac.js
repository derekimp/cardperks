#!/usr/bin/env node
/**
 * iMessage adapter (macOS only).
 *
 * Apple ships no iMessage API, so this is the free route: watch the local
 * Messages database for incoming texts and reply through AppleScript. It is
 * deliberately thin — all the thinking is in lib/engine.js, so a WhatsApp or
 * Telegram adapter is a different 120 lines around the same call.
 *
 * Requirements
 *   • A Mac signed in to iMessage that stays awake.
 *   • Full Disk Access for the terminal running this (System Settings →
 *     Privacy & Security → Full Disk Access), or reading chat.db fails.
 *   • adapters/imessage/config.json listing the handles allowed to ask.
 *
 * Usage
 *   node adapters/imessage-mac.js
 *   node adapters/imessage-mac.js --dry-run   # log replies instead of sending
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { ask } = require("../lib/engine");
const { toText } = require("../lib/format");

const DRY_RUN = process.argv.includes("--dry-run");
const HERE = __dirname;
const CONFIG_PATH = path.join(HERE, "imessage", "config.json");
const STATE_PATH = path.join(HERE, "imessage", ".state.json");
const SEND_SCRIPT = path.join(HERE, "imessage", "send.applescript");
const CHAT_DB = path.join(os.homedir(), "Library", "Messages", "chat.db");

// ── Config ──────────────────────────────────────────────────────────
function loadConfig() {
  let config = { allow: [], pollSeconds: 3, maxRepliesPerMinute: 6 };
  if (fs.existsSync(CONFIG_PATH)) {
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
  }
  const fromEnv = process.env.CARDPERKS_IMESSAGE_ALLOW;
  if (fromEnv) config.allow = fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
  return config;
}

/** Handles are compared with punctuation stripped, so +1 (555) 555-0123 matches. */
function normalizeHandle(handle) {
  const str = String(handle || "").trim().toLowerCase();
  return str.includes("@") ? str : str.replace(/[^\d]/g, "");
}

// ── State ───────────────────────────────────────────────────────────
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch (_) {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Messages database ───────────────────────────────────────────────
function querySqlite(sql) {
  const out = execFileSync("sqlite3", ["-readonly", "-json", CHAT_DB, sql], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : [];
}

function maxRowId() {
  const rows = querySqlite("SELECT IFNULL(MAX(ROWID), 0) AS max_id FROM message;");
  return rows.length ? Number(rows[0].max_id) : 0;
}

/**
 * Recent macOS versions leave `text` NULL and store the body in an
 * NSKeyedArchiver blob. Pull the longest printable run out of it — crude, but
 * it recovers ordinary message text without a native plist dependency.
 */
function textFromAttributedBody(hex) {
  if (!hex) return "";
  let buf;
  try {
    buf = Buffer.from(hex, "hex");
  } catch (_) {
    return "";
  }
  const latin = buf.toString("latin1");
  const runs = latin.match(/[\x20-\x7e -ÿ]{2,}/g) || [];
  const skip = /^(NS|__k|streamtyped|bplist|iI|\$)/;
  const candidates = runs
    .map((r) => r.trim())
    .filter((r) => r.length > 1 && !skip.test(r));
  if (!candidates.length) return "";
  return candidates.sort((a, b) => b.length - a.length)[0];
}

function fetchNewMessages(afterRowId) {
  const sql = `
    SELECT m.ROWID AS row_id,
           m.text AS text,
           hex(m.attributedBody) AS body_hex,
           h.id AS handle
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.is_from_me = 0 AND m.ROWID > ${Number(afterRowId)}
    ORDER BY m.ROWID ASC
    LIMIT 25;`;
  return querySqlite(sql).map((row) => ({
    rowId: Number(row.row_id),
    handle: row.handle || "",
    text: (row.text && row.text.trim()) || textFromAttributedBody(row.body_hex),
  }));
}

// ── Sending ─────────────────────────────────────────────────────────
function sendMessage(handle, text) {
  if (DRY_RUN) {
    console.log(`\n[dry-run] → ${handle}\n${text}\n`);
    return;
  }
  execFileSync("osascript", [SEND_SCRIPT, handle, text], { encoding: "utf8" });
}

// ── Loop ────────────────────────────────────────────────────────────
function makeRateLimiter(maxPerMinute) {
  const sent = new Map();
  return function allow(handle) {
    const now = Date.now();
    const recent = (sent.get(handle) || []).filter((t) => now - t < 60000);
    if (recent.length >= maxPerMinute) {
      sent.set(handle, recent);
      return false;
    }
    recent.push(now);
    sent.set(handle, recent);
    return true;
  };
}

function main() {
  if (process.platform !== "darwin") {
    console.error("This adapter needs macOS — iMessage is not reachable elsewhere.");
    console.error("For a cross-platform channel, deploy api/ask.js and point a webhook at it.");
    process.exit(1);
  }
  if (!fs.existsSync(CHAT_DB)) {
    console.error(`Cannot find ${CHAT_DB}. Is this Mac signed in to Messages?`);
    process.exit(1);
  }

  const config = loadConfig();
  const allow = new Set(config.allow.map(normalizeHandle));
  if (!allow.size) {
    console.error(
      `No allowed senders configured. Copy adapters/imessage/config.example.json to config.json, ` +
        `or set CARDPERKS_IMESSAGE_ALLOW.`
    );
    process.exit(1);
  }

  const allowed = makeRateLimiter(config.maxRepliesPerMinute);
  let state = loadState();
  if (!state) {
    // First run: start from now so old threads are not answered retroactively.
    state = { lastRowId: maxRowId() };
    saveState(state);
    console.log(`Starting fresh at message ROWID ${state.lastRowId}.`);
  }

  console.log(
    `CardPerks iMessage adapter listening (${allow.size} allowed sender${allow.size === 1 ? "" : "s"}` +
      `${DRY_RUN ? ", dry-run" : ""}). Ctrl-C to stop.`
  );

  const tick = () => {
    let messages;
    try {
      messages = fetchNewMessages(state.lastRowId);
    } catch (err) {
      console.error(`Could not read chat.db: ${err.message}`);
      console.error("Grant Full Disk Access to this terminal and try again.");
      return;
    }

    for (const msg of messages) {
      state.lastRowId = Math.max(state.lastRowId, msg.rowId);

      if (!allow.has(normalizeHandle(msg.handle))) continue;
      if (!msg.text) continue;

      console.log(`← ${msg.handle}: ${msg.text}`);
      if (!allowed(msg.handle)) {
        console.warn(`  rate limit reached for ${msg.handle}, skipping`);
        continue;
      }

      try {
        const reply = toText(ask(msg.text));
        sendMessage(msg.handle, reply);
        if (!DRY_RUN) console.log(`→ replied to ${msg.handle}`);
      } catch (err) {
        console.error(`  failed to answer: ${err.message}`);
      }
    }

    if (messages.length) saveState(state);
  };

  tick();
  setInterval(tick, Math.max(1, config.pollSeconds) * 1000);
}

main();
