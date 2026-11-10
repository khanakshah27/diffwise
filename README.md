# Diffwise

A GitHub Action that reads every pull request and leaves one short comment with **what changed** and **what could break**, so reviewers know where to look before they open a single file.

It works with no setup and no account, using built-in rules. Add an Anthropic API key and it also writes a plain-English summary and points out risks the rules cannot see.

## What the comment looks like

> ## Diffwise
>
> Renames `login` to `signIn` and adds a `users` column.
>
> ### What changed
> **4 files**, +5 / −1
> - **Source code** (1, +2 / −1): `src/auth/session.js`
> - **Database** (1, +1 / −0): `db/migrate/001_users.sql` new
> - **Dependencies** (1, +1 / −0): `package.json`
>
> ### What could break
> - 🔴 **Database change.** Check the migration can be rolled back, and that old code still works against the new schema during deploy.
> - 🔴 **Touches authentication or security code.** Worth a second pair of eyes on access checks and error paths.
> - 🟠 **Dependencies changed.** Check versions, licences and release notes.
> - 🟡 **No tests changed.** Is the new behaviour covered?

The comment is **edited in place** on every push, so the thread never fills up.

## Use it

Add this file to your repository as `.github/workflows/diffwise.yml`:

```yaml
name: Diffwise
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: khanakshah27/diffwise@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}   # optional
```

Leave out `anthropic-api-key` to run on rules alone.

| Input | Default | Purpose |
| --- | --- | --- |
| `github-token` | the workflow token | Reads the pull request and posts the comment |
| `anthropic-api-key` | none | Optional. Turns on the written summary and deeper risk notes |
| `model` | `claude-sonnet-5-5` | Claude model used when a key is given |
| `max-diff-chars` | `60000` | How much of the diff is sent to the model |

## What the rules look for

| Level | Signal |
| --- | --- |
| 🔴 High | Database migrations or schema files · authentication, session, token and crypto code · secrets or private keys in added lines |
| 🟠 Medium | Build, deploy and infrastructure files (CI, Dockerfile, Terraform, Kubernetes) · dependency manifests · configuration files · removed or renamed public functions · deleted source files · very large pull requests · lots of new code with no test changes |
| 🟡 Low | Lockfile changed alone · small source changes without tests · leftover `console.log`, `debugger`, `TODO`, `FIXME` |

Rules are plain functions in [`src/risk.js`](src/risk.js). Adding your own takes a few lines.

## Privacy and safety

- **Without an API key, nothing leaves GitHub.** Everything runs inside your workflow.
- **With a key,** the diff (skipping lockfiles and build output, capped at `max-diff-chars`) and the PR title and description are sent to the Anthropic API. Do not enable it on repositories whose code you cannot share.
- **Pull requests from forks never use the key.** GitHub withholds secrets from them, and Diffwise also refuses to send fork code to the model.
- **The diff is treated as untrusted.** The model is told never to follow instructions inside it, and its reply is stripped of HTML and links before it is posted.
- The workflow only needs `pull-requests: write` and `contents: read`.

## How it works

| File | Job |
| --- | --- |
| `src/github.js` | Lists the pull request's files and creates or edits the comment |
| `src/diff.js` | Turns GitHub's file list into added and removed lines, flags lockfiles and build output |
| `src/risk.js` | The rule set |
| `src/llm.js` | Optional model call and a defensive parser for its reply |
| `src/summary.js` | Builds the Markdown comment |
| `src/index.js` | Entry point |

There are no runtime dependencies, so there is nothing to install or build. It needs Node 20, which GitHub's runners provide.

## Develop

```bash
npm test
```

## Known limits

- It reads the diff, not your whole codebase, so it cannot tell who calls a function that was removed. It tells you to check.
- GitHub returns at most 3,000 files per pull request, and may omit the patch for very large files. Those are counted but not analysed line by line.
- Rules are heuristics. Expect some false alarms and some misses. It is a guide for the reviewer, not a replacement for one.

## License

MIT
