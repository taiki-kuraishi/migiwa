# Rebuild conventions

Rules harvested from review findings during the 13-wave rebuild
(`docs/superpowers/plans/2026-09-04-rebuild.md`). They apply to the whole repository,
not only to rebuild work.

## Time-bound notes

A note in repo docs that is only true during part of the rebuild must state the condition
that makes it false, never a wave number, and the plan task that makes it false must carry
the step that removes it. `until wave 6` was already wrong when it was written;
`while no workspace declares a test script` would not have been.

## Registering a generated file

A newly committed generated file is registered in four places, not one:

- `.gitattributes` — `linguist-generated=true`, plus a `-linguist-generated` negation for any
  hand-written file in the same tree.
- `oxlint.config.ts` and `oxfmt.config.ts` — `ignorePatterns`.
- `.editorconfig` — generators do not follow the repo's whitespace rules.

Name the CI step that detects drift in it, and say whether that step compares the file body
or only a header — `cf-typegen --check` compares only a header.
