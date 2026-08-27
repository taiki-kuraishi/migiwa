---
name: create-pr
description: Open a pull request for this repo following its conventions — a gitmoji-prefixed title, the PR template body, and gh stack for stacked PRs. Use whenever creating a PR in this repository.
---

# Create a PR (migiwa)

## 1. Branch
Work on a feature branch, never `main` (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`, ...).

## 2. Title — ALWAYS prefix with a git emoji (gitmoji)
Format: `<gitmoji> <type>(<scope>): <summary>` (scope optional).

| gitmoji | type | when |
|---|---|---|
| ✨ | feat | new feature |
| 🐛 | fix | bug fix |
| 📝 | docs | docs only |
| ♻️ | refactor | restructure, no behavior change |
| ⚡️ | perf | performance |
| ✅ | test | tests only |
| 🔧 | chore | config / tooling |
| 👷 | ci | CI / workflows |
| ⬆️ | deps | dependency bumps |
| 🔥 | remove | remove code / files |

Example: `✨ feat(gateway): classify gateway close codes`

## 3. Body
Fill `.github/pull_request_template.md` (Summary / Changes / Testing / Notes).

## 4. Verify before opening — all must be green
```
bun dedupe --check
bunx vp run oxlint --deny-warnings
bunx vp run oxfmt --check
bunx vp run type-check
bunx vp run -r type-check
bunx vp run -r test
bun run knip
```

## 5. Open the PR (stacked — this repo uses `gh stack`)
- New stack (branches off main): `gh stack init <branch>`, commit, then `gh stack submit --auto --open`.
- Stack on top of an open PR: `gh stack add <branch>`, commit, then `gh stack submit --auto --open`.
- `gh stack submit --auto` uses an auto title, so set the real gitmoji title + template body afterward:
  `gh pr edit <n> --title "<gitmoji> <type>(<scope>): <summary>" --body-file <path>`.

Non-stacked fallback: `gh pr create --base <base> --title "<gitmoji> ..." --body-file <path>`.
