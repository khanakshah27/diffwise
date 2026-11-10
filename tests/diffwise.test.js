const test = require("node:test");
const assert = require("node:assert");
const { normalizeFiles, stats, diffForModel } = require("../src/diff");
const { analyze } = require("../src/risk");
const { parseModelReply, askModel } = require("../src/llm");
const { render, MARK } = require("../src/summary");
const { upsertComment } = require("../src/github");

const file = (filename, patch = "", extra = {}) => {
  const add = patch.split("\n").filter((l) => l.startsWith("+")).length;
  const del = patch.split("\n").filter((l) => l.startsWith("-")).length;
  return { filename, status: "modified", additions: add, deletions: del, patch, ...extra };
};
const run = (...fs) => analyze(normalizeFiles(fs));
const titles = (r) => r.map((x) => x.title);

test("normalizeFiles splits added and removed lines and flags lockfiles", () => {
  const [a, b] = normalizeFiles([file("src/a.js", "@@ -1 +1 @@\n-old\n+new"), file("package-lock.json", "+x")]);
  assert.deepStrictEqual([a.added, a.removed], [["new"], ["old"]]);
  assert.strictEqual(b.lockfile, true);
});

test("stats totals additions and deletions", () => {
  assert.deepStrictEqual(stats(normalizeFiles([file("a.js", "+1\n+2\n-3")])), { files: 1, additions: 2, deletions: 1 });
});

test("flags database migrations as high risk", () => {
  const r = run(file("db/migrate/20260101_add_users.sql", "+CREATE TABLE users();"));
  assert.ok(titles(r).includes("Database change"));
  assert.strictEqual(r[0].level, "high");
});

test("flags auth code and committed secrets", () => {
  const r = run(file("src/auth/login.js", "+if (user) return true"), file("src/cfg.js", '+const k = "AKIAABCDEFGHIJKLMNOP"'));
  assert.ok(titles(r).includes("Touches authentication or security code"));
  assert.ok(titles(r).includes("Possible secret committed"));
});

test("flags source changes with no tests, but not when tests change too", () => {
  const withoutTests = run(file("src/app.js", "+a\n+b"));
  assert.ok(titles(withoutTests).includes("No tests changed"));
  const withTests = run(file("src/app.js", "+a"), file("tests/app.test.js", "+t"));
  assert.ok(!titles(withTests).includes("No tests changed"));
});

test("flags removed exported functions", () => {
  const r = run(file("src/api.js", "-export function getUser() {}\n+// gone"));
  assert.ok(titles(r).includes("Removed or renamed public functions"));
});

test("a rename counts as a removal, an edit does not", () => {
  assert.ok(titles(run(file("src/a.js", "-export function login() {}\n+export function signIn() {}"))).includes("Removed or renamed public functions"));
  assert.ok(!titles(run(file("src/a.js", "-export function login(a) {}\n+export function login(a, b) {}"))).includes("Removed or renamed public functions"));
});

test("notes dependency and CI changes", () => {
  const r = run(file("package.json", '+"left-pad": "1"'), file(".github/workflows/ci.yml", "+run: x"));
  assert.ok(titles(r).includes("Dependencies changed"));
  assert.ok(titles(r).includes("Build, deploy or infrastructure change"));
});

test("a tiny docs change has no findings", () => {
  assert.deepStrictEqual(run(file("README.md", "+hello")), []);
});

test("large pull requests are called out", () => {
  const many = Array.from({ length: 30 }, (_, i) => file(`docs/f${i}.md`, "+x"));
  assert.ok(titles(run(...many)).includes("Large pull request"));
});

test("diffForModel skips lockfiles and respects the budget", () => {
  const files = normalizeFiles([file("yarn.lock", "+junk"), file("a.js", "+" + "x".repeat(500)), file("b.js", "+" + "y".repeat(500))]);
  const d = diffForModel(files, 700);
  assert.ok(!d.includes("junk"));
  assert.ok(d.includes("truncated"));
  assert.ok(d.length < 900);
});

test("parseModelReply tolerates fences and strips markup", () => {
  const r = parseModelReply('```json\n{"summary":"Adds <b>login</b> [docs](http://x)","risks":[{"title":"Race","why":"Two writers"}]}\n```');
  assert.strictEqual(r.summary, "Adds login docs");
  assert.strictEqual(r.risks.length, 1);
  assert.throws(() => parseModelReply("no json here"));
});

test("askModel sends the key and returns parsed output", async () => {
  let seen;
  const fake = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ content: [{ type: "text", text: '{"summary":"ok","risks":[]}' }] }) }; };
  const out = await askModel({ apiKey: "k", model: "m", title: "t", body: "b", diff: "d", fetchImpl: fake });
  assert.strictEqual(out.summary, "ok");
  assert.strictEqual(seen.opts.headers["x-api-key"], "k");
  assert.strictEqual(JSON.parse(seen.opts.body).model, "m");
});

test("render produces a marked comment with both sections", () => {
  const files = normalizeFiles([file("src/a.js", "+1")]);
  const md = render({ files, st: stats(files), findings: analyze(files), ai: null, aiError: false });
  assert.ok(md.startsWith(MARK));
  assert.ok(md.includes("### What changed") && md.includes("### What could break"));
});

test("upsertComment edits an existing Diffwise comment instead of posting a new one", async () => {
  const calls = [];
  const fake = async (url, opts = {}) => {
    calls.push((opts.method || "GET") + " " + url.replace("https://api.github.com", ""));
    if (!opts.method) return { ok: true, status: 200, json: async () => [{ id: 7, body: "hi " + MARK }] };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await upsertComment("t", "o/r", 3, "body", MARK, fake);
  assert.ok(calls[1].startsWith("PATCH /repos/o/r/issues/comments/7"));
});
