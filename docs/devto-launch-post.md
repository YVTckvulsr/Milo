# I built a zero-config GitHub Action that reviews your PRs like a senior developer

*Tags: github, opensource, webdev, devops*

---

Every team has that one senior developer who does the first-pass review before a PR reaches the team.

They check: did you write tests? Did you accidentally commit a secret? Is this a breaking change that'll break users? Is this PR too large to review properly? They don't just flag issues — they explain *why* it matters.

Most teams don't have that person available 24/7. I built one.

## The problem with existing tools

Before building Milo, I looked at what's out there:

| Tool | Problem |
|------|---------|
| **Danger.js** | Requires writing a `Dangerfile` — another thing to maintain |
| **GitHub Code Scanning** | Security-only, complex setup |
| **Codecov / Codacy** | Paid beyond basic usage, heavy integration |
| **Stale bot** | Just closes issues, zero intelligence |

None of them work in under 60 seconds on a new repo. None of them give you a human-readable summary of what a PR actually does. And none of them are free AND intelligent AND zero-config.

## Introducing Milo

Milo is a GitHub Action that posts a structured health report on every PR — no configuration required.

```yaml
# .github/workflows/milo.yml
name: Milo PR Health Check
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  milo:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      issues: write
      checks: write
    steps:
      - uses: actions/checkout@v4
      - uses: yvtckvulsr/milo@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Optional: add your Anthropic key to unlock AI features
          # anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

That's it. Add this to your repo and every PR immediately gets this:

```
🟡 Milo — Health Score: 6.5/10

📋 Summary
> This PR adds JWT authentication to replace session cookies, supporting
> mobile clients. The core flow is solid but the token signing utility
> has no tests and a hardcoded expiry.

🏥 Health Checks
|    | Check            | Status                                     |
|----|------------------|--------------------------------------------|
| ✅ | Description      | Provided                                   |
| 🚨 | Secrets          | 1 potential secret found                   |
| ⚠️ | Tests            | 2 file(s) without a test file              |
| ✅ | TODOs            | None added                                 |
| ⚠️ | Breaking changes | 1 possible breaking change                 |
| ⚠️ | Dependencies     | 1 major bump                               |

🚨 Secrets Detected — Do Not Merge
- AWS Access Key · `src/config.ts` line 14 · entropy 4.8

⚠️ 2 files without a test file
- `src/auth/jwt.ts` (new)
- `src/middleware/auth.ts`

⚠️ Concerns
- `jwt.sign()` defaults to HS256 — consider RS256 for production
- Token expiry is hardcoded to 7 days on line 34

💡 Suggestions
- Add tests for jwt.ts covering expiry and invalid-token edge cases
- Move the secret key out of config.ts into an environment variable

✂️ Consider Splitting This PR
Split into: (1) JWT utility + tests, (2) Express middleware + integration tests

⏱️ ~22 min to review · areas: `source` `config`
```

## What makes it different

**Zero config** — works on any repo immediately. No Dangerfile, no YAML config required.

**Shannon entropy filtering** — most "secret detectors" flag `YOUR_API_KEY_HERE` as a real secret. Milo uses information entropy to distinguish real secrets (high randomness) from placeholders (low randomness). Far fewer false positives.

**Test file existence check** — most tools flag a source file as "untested" if no test file was modified in the PR. But what if the test file already exists and didn't need changes? Milo fetches the repo's file tree in a single API call and checks if a matching test file actually exists. Only flags genuine gaps.

**Inline GitHub Check annotations** — when Milo finds a secret on line 42 of `config.ts`, it creates an inline annotation on that exact line in the "Files Changed" tab — just like a human reviewer would.

**Multi-language test detection** — TypeScript, JavaScript, Python, Go, Java, Kotlin, Ruby, PHP, Rust, C/C++.

**Dependency change analysis** — detects major version bumps, added/removed packages, and prerelease upgrades across npm, pip, and Go modules.

**Breaking change detection** — removed exports, deleted API routes, destructive SQL migrations (DROP TABLE, DROP COLUMN). Skips commented-out code to avoid false positives.

**Works without AI** — the static analysis gives real value even without an API key. The AI layer (Claude via Anthropic API) adds PR summaries, concerns, and split suggestions on top.

## Under the hood

A few technical decisions I found interesting:

**Shannon entropy for secret detection.** Real API keys and tokens are essentially random byte sequences. Placeholders like `EXAMPLE_KEY` are not. Shannon entropy measures bits of information per character. A real AWS secret key scores ~4.8 bits/char. An example string scores ~3.2. Requiring entropy > 3.8 for generic patterns eliminates most placeholder false positives without affecting real secrets.

**Single API call for coverage enrichment.** Instead of N API calls to check if test files exist (one per source file), Milo fetches the entire repo file tree in a single `git.getTree({ recursive: true })` call, builds a Set of all file paths, then checks candidates locally. Fast and cheap.

**Priority-based diff selection for AI.** Large PRs can have diffs bigger than a model's context window. Instead of slicing at character N (which cuts mid-function), Milo sorts files by complexity score (source files > config > docs, weighted by lines changed), fills up to the character limit in priority order, and notes which files were excluded. The AI always sees the most important code.

## The configuration (optional)

For teams that want to customize:

```yaml
# .milo.yml
checks:
  secrets: true
  tests: true
  breaking_changes: true
  dependencies: true

thresholds:
  fail_on_score_below: 5   # block merges below this score
  secret_entropy_min: 3.5

ignore:
  paths:
    - "vendor/**"
    - "*.generated.ts"

custom_secrets:
  - name: "Our Internal Token"
    pattern: "MYCO_[A-Z0-9]{32}"

skip_drafts: true
```

## What's next

- GitHub Marketplace listing (in progress)
- Support for Cargo.toml and pom.xml dependency parsing
- Configurable score weights per team

## Try it

The project is open source: [github.com/yvtckvulsr/milo](https://github.com/yvtckvulsr/milo)

Add the workflow to your repo in 30 seconds. It'll run on the next PR you open.

If you find a false positive or a missing feature — open an issue. The codebase is TypeScript, well-tested (54 tests), and easy to contribute to.

---

*Built with TypeScript, the GitHub Actions SDK, and the Anthropic API.*
