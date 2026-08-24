#!/usr/bin/env bash
# Pre-push guard: CI checks the PR merged with prod, so local runs on a
# skewed branch can pass while CI fails. Block the push only when
# origin/prod has changed files this branch also touches.
set -euo pipefail

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "prod" ] || [ "$branch" = "staging" ] || [ "$branch" = "HEAD" ]; then
  exit 0
fi

git fetch --quiet origin prod || true
git rev-parse --verify --quiet origin/prod >/dev/null || exit 0

base=$(git merge-base HEAD origin/prod)
if [ "$base" = "$(git rev-parse origin/prod)" ]; then
  exit 0
fi

overlap=$(comm -12 \
  <(git diff --name-only "$base" origin/prod -- | sort) \
  <(git diff --name-only "$base" HEAD -- | sort))

if [ -z "$overlap" ]; then
  exit 0
fi

{
  echo "Branch is behind origin/prod, and prod changed files this branch also touches:"
  echo "$overlap" | sed 's/^/  /'
  echo "Local checks ran on a tree CI will never test. Run 'git merge origin/prod',"
  echo "resolve, re-run checks, then push."
} >&2
exit 1
