/**
 * HTTP entry point, deployed as a Vercel serverless function.
 *
 * This is the seam that makes new channels cheap: WhatsApp Cloud API, Telegram,
 * Slack and the Shortcuts app are all webhook-plus-REST, so each one becomes a
 * thin adapter that POSTs here and posts the reply back to its own send API.
 *
 *   GET  /api/ask?q=what+card+for+uniqlo
 *   POST /api/ask   {"question": "what card for uniqlo"}
 */

const { ask } = require("../lib/engine");
const { toText } = require("../lib/format");

module.exports = function handler(req, res) {
  let question = "";

  if (req.method === "GET") {
    question = (req.query && (req.query.q || req.query.question)) || "";
  } else if (req.method === "POST") {
    const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
    question = body.question || body.q || body.text || "";
  } else {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  question = String(question).slice(0, 500).trim();
  if (!question) {
    res.status(400).json({ error: "Missing question" });
    return;
  }

  try {
    const answer = ask(question);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ reply: toText(answer), answer });
  } catch (err) {
    res.status(500).json({ error: "Failed to answer", detail: err.message });
  }
};

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return {};
  }
}
