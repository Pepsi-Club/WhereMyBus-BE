---
name: managing-git-workflows
description: Use when creating or switching Git branches, staging changes, writing commit messages, committing, pulling, merging, rebasing, tagging, or pushing to a remote.
---

# Managing Git Workflows

## Overview

Complete requested Git operation while preserving unrelated work and remote history. Mutate only authorized scope.

## Workflow

1. Read repository instructions. Inspect status, branch, remotes, relevant diff, and recent names.
2. Resolve target files, base branch, remote, and history effect. Git output alone does not prove file ownership.
3. Stage only task-owned paths or hunks. In mixed worktrees, use explicit paths or `git add -p`; never broad staging. Review `git diff --cached`.
4. Verify staged changes. Report unrelated failures without expanding scope.
5. Perform only requested mutations. Commit does not authorize push; push does not authorize history rewrite.
6. Recheck status and history. Report branch, commit hash/message, push result, and remaining changes.

## Naming Rules

Written repository rules and clear established convention override these fallbacks. If recent history is mixed, use fallbacks consistently.

### Commits

Format: `[Type] 한국어 요약`

| Type | Purpose |
| --- | --- |
| `Feat` | New behavior |
| `Fix` | Bug fix |
| `Refactor` | Behavior-preserving change |
| `Test` | Test-only change |
| `Docs` | Documentation-only change |
| `Chore` | Maintenance, tooling, dependency, config |
| `Style` | Formatting-only change |
| `Perf` | Performance improvement |

One logical change per commit. Keep summary concise, omit trailing period. Add body only for non-obvious reason, trade-off, or migration impact. Use issue-closing footer only when change fully resolves known issue. Never invent issue number.

Example: `[Fix] 버스 도착 정보 필터링 오류 수정`

### Branches

- With issue: `<type>/#<issue-number>` — `feat/#53`, `fix/#55`
- Without issue: `<type>/<short-kebab-description>` — `docs/update-api-guide`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `perf`

Confirm base branch before creation. Never invent issue number.

## History Safety

| Situation | Action |
| --- | --- |
| First push | Push explicit remote/branch and set upstream |
| Non-fast-forward rejection | Fetch, compare histories, explain options |
| Shared branch diverged | Ask before rebase or rewrite |
| Explicitly authorized rewrite | Recheck exact target; use `--force-with-lease`, never `--force` |
| Dirty tree before switch/rebase/merge | Preserve changes; do not discard or stash without authorization |
| Conflict | Report paths/state; never guess semantic resolution |

Never use `reset --hard`, `clean -fd`, branch deletion, or reflog-expiring operations without explicit authorization covering exact targets and irreversible effect. Create backup ref before authorized risky rewrite.

## Common Mistakes and Stop Conditions

- Mixed message history: follow precedence above; do not invent third convention.
- Unknown remote/default branch/upstream: inspect, never assume.
- Existing commit amend: inspect authorship and publication first.
- Task-owned changes cannot be distinguished: stop and ask for paths or hunks.
- Target branch/base/remote is ambiguous: stop and ask.
- Operation could overwrite, delete, or hide work: preserve state and ask.
- Verification fails for staged change: stop and report failure.
