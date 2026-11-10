/* Rules that spot the kinds of changes that tend to break things. Each returns findings with a level: high, medium or low. */
"use strict";

const isTest = (p) => /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i.test(p);
const isDoc = (p) => /\.(md|mdx|rst|txt)$/i.test(p) || /(^|\/)docs?\//i.test(p);
const isSource = (p) => /\.(js|jsx|ts|tsx|py|java|kt|go|rb|rs|c|cc|cpp|h|cs|php|swift|scala|dart|vue|svelte)$/i.test(p) && !isTest(p);
const isMigration = (p) => /(^|\/)(migrations?|alembic|db\/migrate|prisma\/migrations)\//i.test(p) || /schema\.(sql|prisma)$|\.sql$/i.test(p);
const isCi = (p) => /^\.github\/workflows\/|(^|\/)(Jenkinsfile|\.gitlab-ci\.yml|azure-pipelines\.yml|\.circleci\/)/.test(p);
const isInfra = (p) => /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|.*\.tf|helm\/|k8s\/|kubernetes\/|terraform\/)/i.test(p);
const isManifest = (p) => /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|go\.mod|pom\.xml|build\.gradle(\.kts)?|Gemfile|Cargo\.toml|composer\.json|pubspec\.yaml)$/.test(p);
const isEnvConfig = (p) => /(^|\/)(\.env[^/]*|[^/]*\.(ya?ml|toml|ini|conf))$/i.test(p) && !isCi(p) && !isInfra(p) && !isManifest(p);
const isSecurityPath = (p) => /(auth|login|logout|session|permission|rbac|acl|oauth|jwt|token|password|crypto|secret|security|csrf|cors)/i.test(p);

const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, "an AWS access key"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "a private key"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, "a GitHub token"],
  [/sk-[A-Za-z0-9_-]{24,}/, "an API key"],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i, "a hard-coded credential"],
];

function analyze(files) {
  const out = [];
  const add = (level, title, detail, paths = []) => out.push({ level, title, detail, files: paths.slice(0, 6), more: Math.max(0, paths.length - 6) });
  const real = files.filter((f) => !f.generated);
  const total = real.reduce((a, f) => a + f.additions + f.deletions, 0);

  // credentials in added lines
  const leaks = [];
  for (const f of real) {
    for (const [re, what] of SECRET_PATTERNS) {
      if (f.added.some((l) => re.test(l))) { leaks.push([f.path, what]); break; }
    }
  }
  if (leaks.length) add("high", "Possible secret committed", `Looks like ${[...new Set(leaks.map((l) => l[1]))].join(", ")}. If it is real, rotate it, because it stays in git history even after removal.`, leaks.map((l) => l[0]));

  const migrations = real.filter((f) => isMigration(f.path));
  if (migrations.length) add("high", "Database change", "Check the migration can be rolled back, that old code still works against the new schema during deploy, and how it behaves on a large table.", migrations.map((f) => f.path));

  const security = real.filter((f) => isSecurityPath(f.path) && !isDoc(f.path) && !isTest(f.path));
  if (security.length) add("high", "Touches authentication or security code", "Mistakes here are costly and hard to spot. Worth a second pair of eyes on access checks, token handling and error paths.", security.map((f) => f.path));

  const ci = real.filter((f) => isCi(f.path) || isInfra(f.path));
  if (ci.length) add("medium", "Build, deploy or infrastructure change", "Can break releases without touching application code. Confirm it was run somewhere safe first.", ci.map((f) => f.path));

  const manifests = real.filter((f) => isManifest(f.path));
  const lock = real.filter((f) => f.lockfile);
  if (manifests.length) add("medium", "Dependencies changed", "New or upgraded packages can change behaviour and add supply-chain risk. Check versions, licences and release notes.", manifests.map((f) => f.path));
  else if (lock.length) add("low", "Lockfile changed without a manifest change", "Usually harmless, but it means installed versions moved. Check this was intended.", lock.map((f) => f.path));

  const cfg = real.filter((f) => isEnvConfig(f.path));
  if (cfg.length) add("medium", "Configuration changed", "Config errors only show up at runtime. Check every environment (staging, production) has matching values.", cfg.map((f) => f.path));

  // removed or renamed public symbols
  // a public symbol that existed before and is not defined again in the same file is gone or renamed
  const symbolRe = /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|interface|type)\s+(\w+)|public\s+(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\(|def\s+([a-zA-Z]\w*)\s*\(|func\s+([A-Z]\w*)\s*\()/;
  const names = (lines) => new Set(lines.map((l) => symbolRe.exec(l)).filter(Boolean).map((m) => m[1] || m[2] || m[3] || m[4]));
  const removedApi = real.filter((f) => {
    if (!isSource(f.path) || f.status === "removed") return false;
    const gone = [...names(f.removed)].filter((n) => !names(f.added).has(n));
    return gone.length > 0;
  });
  if (removedApi.length) add("medium", "Removed or renamed public functions", "Callers elsewhere in the codebase (or other repos) may still use them. Search for usages before merging.", removedApi.map((f) => f.path));

  const removedFiles = real.filter((f) => f.status === "removed" && isSource(f.path));
  if (removedFiles.length) add("medium", "Files deleted", "Check nothing still imports or loads them, including dynamic imports and config references.", removedFiles.map((f) => f.path));

  const srcChanged = real.filter((f) => isSource(f.path) && f.status !== "removed");
  const testsChanged = real.filter((f) => isTest(f.path));
  if (srcChanged.length && !testsChanged.length) {
    const lines = srcChanged.reduce((a, f) => a + f.additions, 0);
    add(lines > 30 ? "medium" : "low", "No tests changed", `${srcChanged.length} source file${srcChanged.length > 1 ? "s" : ""} changed (${lines} lines added) with no test changes. Is the new behaviour covered?`, srcChanged.map((f) => f.path));
  }

  if (real.length > 25 || total > 800) add("medium", "Large pull request", `${real.length} files and ${total} changed lines. Big changes get skimmed. Consider splitting it, or review commit by commit.`);

  const noise = real.filter((f) => isSource(f.path) && f.added.some((l) => /\b(console\.log|debugger|print\(\s*["']debug|TODO|FIXME|XXX)\b/.test(l)));
  if (noise.length) add("low", "Debug code or TODOs left in", "console.log, debugger statements or TODO/FIXME comments were added.", noise.map((f) => f.path));

  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

function categorize(path) {
  if (isMigration(path)) return "Database";
  if (isTest(path)) return "Tests";
  if (isCi(path) || isInfra(path)) return "Build and infrastructure";
  if (isManifest(path) || /lock/i.test(path)) return "Dependencies";
  if (isDoc(path)) return "Docs";
  if (isEnvConfig(path)) return "Configuration";
  if (isSource(path)) return "Source code";
  return "Other";
}

module.exports = { analyze, categorize, isTest, isSource };
