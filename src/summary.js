/* Builds the Markdown comment. */
"use strict";
const { categorize } = require("./risk");

const MARK = "<!-- diffwise -->";
const ICON = { high: "🔴", medium: "🟠", low: "🟡" };
const code = (s) => "`" + String(s).replace(/`/g, "'") + "`";

function whatChanged(files, st) {
  const groups = new Map();
  for (const f of files) {
    const c = categorize(f.path);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(f);
  }
  const order = ["Source code", "Database", "Dependencies", "Build and infrastructure", "Configuration", "Tests", "Docs", "Other"];
  const lines = [`**${st.files} file${st.files === 1 ? "" : "s"}**, +${st.additions} / −${st.deletions}`, ""];
  for (const name of order) {
    const list = groups.get(name);
    if (!list) continue;
    const top = [...list].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions)).slice(0, 4);
    const adds = list.reduce((a, f) => a + f.additions, 0), dels = list.reduce((a, f) => a + f.deletions, 0);
    lines.push(`- **${name}** (${list.length}, +${adds} / −${dels}): ${top.map((f) => code(f.path) + (f.status === "added" ? " new" : f.status === "removed" ? " deleted" : f.status === "renamed" ? " renamed" : "")).join(", ")}${list.length > top.length ? `, and ${list.length - top.length} more` : ""}`);
  }
  return lines.join("\n");
}

function render({ files, st, findings, ai, aiError }) {
  const parts = [MARK, "## Diffwise", ""];
  if (ai && ai.summary) parts.push(ai.summary, "");
  parts.push("### What changed", whatChanged(files, st), "");

  parts.push("### What could break");
  const aiRisks = (ai && ai.risks) || [];
  if (!findings.length && !aiRisks.length) {
    parts.push("Nothing stands out. Small, contained change.", "");
  } else {
    for (const f of findings) {
      const where = f.files.length ? ` ${f.files.map(code).join(", ")}${f.more ? ` and ${f.more} more` : ""}` : "";
      parts.push(`- ${ICON[f.level]} **${f.title}.** ${f.detail}${where ? "\n  " + where : ""}`);
    }
    for (const r of aiRisks) parts.push(`- 🔎 **${r.title}.** ${r.why}`);
    parts.push("");
  }

  const checks = findings.filter((f) => f.level !== "low").slice(0, 4).map((f) => f.title);
  if (checks.length) parts.push("<details><summary>Suggested review focus</summary>", "", ...checks.map((c) => `- [ ] ${c}`), "", "</details>", "");

  parts.push(`<sub>${ai ? "Rules plus an AI read of the diff." : "Rule-based review."}${aiError ? " (AI summary unavailable this run.)" : ""} A guide for the reviewer, not a replacement for one.</sub>`);
  return parts.join("\n");
}

module.exports = { render, MARK, whatChanged };
