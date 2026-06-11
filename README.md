# Milo — AI PR Health Check

**The most complete zero-config PR analysis for GitHub.**

Milo runs on every pull request and posts a structured health report in seconds. No Dangerfile. No configuration file required. One line of YAML.

---

## What Milo posts

```
🟡 Milo — Health Score: 6/10

📋 Summary
> This PR replaces session cookies with JWT authentication to support mobile
> clients. The core logic is solid but the token signing utility is untested.

🏥 Health Checks
|    | Check            | Status                                      |
|----|------------------|---------------------------------------------|
| ✅ | Description      | Provided                                    |
| 🚨 | Secrets          | 1 potential secret found                    |
| ⚠️ | Tests            | 2 file(s) changed without test updates      |
| ✅ | TODOs            | None added                                  |
| ⚠️ | Breaking changes | 1 possible breaking change                  |
| ⚠️ | PR size          | +340/-12 lines · 8 files                    |
| ⚠️ | Dependencies     | 1 major bump                                |

🚨 Secrets Detected — Do Not Merge
- AWS Access Key · `src/config.ts` line 14

⚠️ 1 possible breaking change
- 📦 `src/auth/index.ts:22` — Exported `verifySession` was removed or renamed

🧪 2 files without test coverage
- `src/auth/jwt.ts` (new)
- `src/middleware/auth.ts`

📦 Dependency changes
| Package   | Change      | Version              |
|-----------|-------------|----------------------|
| `jsonwebtoken` | ➕ added | `^9.0.0`        |
| `express` | ⚠️ major-bump | `^4.18.0` → `^5.0.0` |

⚠️ Concerns
- `jwt.sign()` uses HS256 by default — consider RS256 for production
- Token expiry is hardcoded to 7 days on line 34

💡 Suggestions
- Add unit tests for `jwt.ts` covering expiry and invalid-token cases
- Move the secret key to an env variable, not a config import

✂️ Consider Splitting This PR
Split into: (1) JWT utility + tests, (2) Express middleware + integration tests

⏱️ ~22 min to review · areas: `source` `tests` `config`
· labels: `size/L` `milo/secrets-found` `milo/needs-tests` `milo/breaking-change`
```

---

## Quick start

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
      pull-requests: write   # post/update comment
      issues: write          # apply labels
      checks: write          # inline annotations in Files Changed tab
    steps:
      - uses: yvtckvulsr/milo@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Optional: add your Anthropic key to unlock AI features
          # anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

That's it. Works immediately on any repo, any language.

---

## Features

| Feature | Without AI key | With AI key |
|---------|:-:|:-:|
| Secret detection (15+ patterns) | ✅ | ✅ |
| Multi-language test gap detection | ✅ | ✅ |
| Breaking change detection (exports, SQL, routes) | ✅ | ✅ |
| Dependency change analysis (npm/pip/go/cargo) | ✅ | ✅ |
| Auto-labeling (size, needs-tests, secrets, breaking) | ✅ | ✅ |
| TODO/FIXME tracker | ✅ | ✅ |
| Complexity score & review time estimate | ✅ | ✅ |
| GitHub Check Run with inline file annotations | ✅ | ✅ |
| Updates existing comment (no spam) | ✅ | ✅ |
| AI-generated PR summary | — | ✅ |
| Smart concerns & suggestions | — | ✅ |
| Split suggestions for large PRs | — | ✅ |

---

## Languages supported (test gap detection)

TypeScript · JavaScript · Python · Go · Java · Kotlin · Ruby · PHP · Rust · C/C++

---

## Why Milo beats every alternative

| | Milo | Danger.js | GitHub Code Scanning | Codecov |
|--|:--:|:--:|:--:|:--:|
| Zero config | ✅ | ❌ | ❌ | ❌ |
| Free | ✅ | ✅ | Limited | Limited |
| AI summary | ✅ | ❌ | ❌ | ❌ |
| Breaking change detection | ✅ | Manual | ❌ | ❌ |
| Dep change analysis | ✅ | Manual | ❌ | ❌ |
| Auto-labels | ✅ | Manual | ❌ | ❌ |
| Inline annotations | ✅ | ✅ | ✅ | ❌ |
| No spam (updates comment) | ✅ | ❌ | ✅ | ❌ |

---

## Configuration (optional)

Add `.milo.yml` to your repo root to customize behavior:

```yaml
# .milo.yml
checks:
  secrets: true
  tests: true
  todos: true
  dependencies: true
  breaking_changes: true

labels:
  enabled: true
  size: true
  needs_tests: true
  security: true
  breaking_change: true

thresholds:
  fail_on_score_below: 5   # fail the workflow if health score < 5
  max_pr_lines: 1000

ignore:
  paths:
    - "vendor/**"
    - "*.generated.ts"
    - "dist/**"

custom_secrets:
  - name: "Internal API Token"
    pattern: "MYCO_[A-Z0-9]{32}"
```

---

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | `${{ github.token }}` | Token for comments, labels, and checks |
| `anthropic-api-key` | — | Enables AI features (summary, concerns, split suggestions) |
| `fail-on-secrets` | `true` | Fail the workflow when secrets are detected |

---

## Contributing

```bash
npm install
npm run typecheck   # type-check
npm test            # run 26 tests
npm run build       # bundle to dist/
```

PRs welcome.

---

## License

MIT
