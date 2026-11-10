"use strict";
const API = "https://api.github.com";

function headers(token) {
  return { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "diffwise" };
}

async function gh(token, path, opts = {}, fetchImpl = fetch) {
  const res = await fetchImpl(API + path, { ...opts, headers: { ...headers(token), ...(opts.body ? { "content-type": "application/json" } : {}) } });
  if (!res.ok) throw new Error(`GitHub ${opts.method || "GET"} ${path} failed: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function listPrFiles(token, repo, number, fetchImpl = fetch) {
  const all = [];
  for (let page = 1; page <= 10; page++) { // GitHub caps this list at 3000 files
    const batch = await gh(token, `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`, {}, fetchImpl);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** Edits the existing Diffwise comment if there is one, so the thread is not spammed on every push. */
async function upsertComment(token, repo, number, body, mark, fetchImpl = fetch) {
  const comments = await gh(token, `/repos/${repo}/issues/${number}/comments?per_page=100`, {}, fetchImpl);
  const mine = comments.find((c) => c.body && c.body.includes(mark));
  if (mine) return gh(token, `/repos/${repo}/issues/comments/${mine.id}`, { method: "PATCH", body: JSON.stringify({ body }) }, fetchImpl);
  return gh(token, `/repos/${repo}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) }, fetchImpl);
}

module.exports = { listPrFiles, upsertComment };
