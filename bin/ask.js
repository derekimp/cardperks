#!/usr/bin/env node
/**
 * CLI front end for the answer engine — the fastest way to test replies
 * without a phone in the loop.
 *
 *   node bin/ask.js "what card for uniqlo?"
 *   node bin/ask.js --json "any perks at trader joes"
 */

const { ask } = require("../lib/engine");
const { toText, helpText } = require("../lib/format");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const question = args.filter((a) => a !== "--json").join(" ").trim();

if (!question) {
  console.log(helpText());
  console.log("\nUsage: node bin/ask.js [--json] \"<question>\"");
  process.exit(1);
}

const answer = ask(question);
console.log(asJson ? JSON.stringify(answer, null, 2) : toText(answer));
