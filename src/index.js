"use strict";
const fs = require("fs");
const { normalizeFiles, stats, diffForModel } = require("./diff");
const { analyze } = require("./risk");
const { askModel } = require("./llm");
const { render, MARK } = require("./summary");
const { listPrFiles, upsertComment } = require("./github");

const input = (name, fallback = "") => process.env["INPUT_" + name.toUpperCase().replace(/-/g, "_")] || fallback;

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const pr = event.pull_request;
  if (!pr) { console.log("Not a pull request event, nothing to do."); return; }
  const repo = process.env.GITHUB_REPOSITORY;
  const token = input("github-token");
  if (!token) throw new Error("A github-token is required.");

  const files = normalizeFiles(await listPrFiles(token, repo, pr.number));
  const st = stats(files);
  const findings = analyze(files);

  let ai = null, aiError = false;
  const key = input("anthropic-api-key");
  if (key && !(pr.head && pr.base && pr.head.repo && pr.base.repo && pr.head.repo.full_name !== pr.base.repo.full_name)) {
    try {
      ai = await askModel({ apiKey: key, model: input("model", "claude-sonnet-5-5"), title: pr.title, body: pr.body, diff: diffForModel(files, Number(input("max-diff-chars", "60000"))) });
    } catch (e) { aiError = true; console.log("AI summary skipped:", e.message); }
  }

  const body = render({ files, st, findings, ai, aiError });
  await upsertComment(token, repo, pr.number, body, MARK);
  console.log(`Posted review for PR #${pr.number}: ${st.files} files, ${findings.length} findings.`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { main };
