# Milo — AI PR Health Check

**Zero-config PR analysis that acts like a senior developer doing the first pass.**

Milo runs on every pull request and posts a structured health report: AI summary, test gaps, secret detection, complexity score, and review time estimate. No Dangerfile. No config. One line of YAML.

---

## What Milo posts

```
🟡 Milo — PR Health Score: 6.5/10

📋 Summary
> This PR adds JWT authentication with login and logout endpoints, replacing
> the previous session-cookie approach to support mobile clients.

🏥 Health Checks
| | Check         | Status                                    |
|--|---------------|-------------------------------------------|
| ✅ | Description | Provided                                |
| ✅ | Secrets     | None detected                           |
| ⚠️ | Test coverage| 2 file(s) changed without tests         |
| ⚠️ | TODOs        | 3 new TODO/FIXME                        |
| ⚠️ | PR size     | +340/-12 lines across 8 files           |

🧪 Missing Test Coverage
- `src/auth/jwt.ts` *(new file)*
- `src/middleware/auth.ts`

⚠️ Concerns
- Token expiry is hardcoded to 7 days — should be configurable
- `refreshToken()` is exported but never called

💡 Suggestions
- Add tests for jwt.ts covering expiry edge cases
- Move the 7-day constant to an env variable

✂️ Consider Splitting This PR
Split into: (1) JWT utility + tests, (2) API endpoints + integration tests

⏱️ Estimated Review Time: ~22 min
> Areas touched: `source`, `tests`, `config`
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
      pull-requests: write
    steps:
      - uses: yvtckvulsr/milo@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Optional: add your Anthropic key to unlock AI features
          # anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

That's it. Milo works immediately with no configuration.

---

## Features

| Feature | Without AI key | With AI key |
|---------|:-:|:-:|
| Secret detection (10+ patterns) | ✅ | ✅ |
| Test coverage gap detection | ✅ | ✅ |
| TODO/FIXME tracker | ✅ | ✅ |
| Complexity score & review time estimate | ✅ | ✅ |
| Updates existing comment (no spam) | ✅ | ✅ |
| AI-generated PR summary | — | ✅ |
| Smart concerns & suggestions | — | ✅ |
| Split suggestions for large PRs | — | ✅ |

---

## Why Milo?

Most PR tools require a `Dangerfile`, a config file, or a paid plan. Milo:

- **Works in 30 seconds** — one `uses:` line, no config
- **Understands context** — Claude reads your diff, not just patterns
- **Degrades gracefully** — full value without an API key
- **Stays quiet** — updates its own comment instead of spamming the thread
- **Free and open source** — always

---

## Configuration

All inputs are optional except `github-token` (which defaults to `${{ github.token }}`).

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | `${{ github.token }}` | Token for posting comments |
| `anthropic-api-key` | — | Enables AI features (summary, concerns, split suggestions) |
| `fail-on-secrets` | `true` | Fail the workflow when secrets are detected |

---

## Contributing

1. Fork and clone the repo
2. `npm install`
3. `npm run typecheck` — type-check
4. `npm test` — run tests
5. `npm run build` — bundle to `dist/`

PRs welcome.

---

## License

MIT
