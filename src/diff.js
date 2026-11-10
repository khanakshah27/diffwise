/* Parses the file list GitHub returns for a pull request into something easy to reason about. */
"use strict";

const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|Gemfile\.lock|Cargo\.lock|composer\.lock|go\.sum)$/;
const GENERATED = /(^|\/)(dist|build|node_modules|vendor|__snapshots__)\/|\.min\.(js|css)$|\.map$/;

function normalizeFiles(apiFiles) {
  return apiFiles.map((f) => {
    const patch = f.patch || "";
    const added = [], removed = [];
    for (const line of patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
      else if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
    }
    return {
      path: f.filename,
      previous: f.previous_filename || null,
      status: f.status, // added | removed | modified | renamed
      additions: f.additions || 0,
      deletions: f.deletions || 0,
      patch,
      added,
      removed,
      lockfile: LOCKFILES.test(f.filename),
      generated: GENERATED.test(f.filename),
    };
  });
}

function stats(files) {
  return {
    files: files.length,
    additions: files.reduce((a, f) => a + f.additions, 0),
    deletions: files.reduce((a, f) => a + f.deletions, 0),
  };
}

/** The diff as one string for the model: skips lockfiles and generated output, trims to a budget. */
function diffForModel(files, maxChars) {
  let out = "";
  for (const f of files) {
    if (f.lockfile || f.generated || !f.patch) continue;
    const head = `--- ${f.status.toUpperCase()}: ${f.path} (+${f.additions} -${f.deletions})\n`;
    const chunk = head + f.patch + "\n";
    if (out.length + chunk.length > maxChars) {
      const room = maxChars - out.length - head.length;
      if (room > 400) out += head + f.patch.slice(0, room) + "\n[truncated]\n";
      out += "\n[diff truncated: some files omitted]\n";
      break;
    }
    out += chunk;
  }
  return out;
}

module.exports = { normalizeFiles, stats, diffForModel };
