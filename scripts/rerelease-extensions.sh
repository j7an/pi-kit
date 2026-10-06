#!/bin/sh
# Wait sequentially: tag-release's concurrency group cancels older pending runs.
# If an extension is ever omitted, check the list against shared's dependents.
# Requires GH_TOKEN and GH_REPO.
set -u
failed=
for wf in "$@"; do
  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if ! output=$(gh workflow run "$wf" --ref main -f bump=auto 2>&1); then
    printf '%s\n' "$output" >&2
    failed="$failed $wf"
    continue
  fi
  id=$(printf '%s\n' "$output" | sed -n 's|.*/actions/runs/\([0-9][0-9]*\).*|\1|p' | head -n 1)
  attempt=0
  while [ -z "$id" ] && [ "$attempt" -lt 10 ]; do
    attempt=$((attempt + 1))
    id=$(gh run list --workflow "$wf" --event workflow_dispatch --branch main --json databaseId,createdAt \
      --jq "map(select(.createdAt >= \"$started\")) | sort_by(.createdAt) | last | .databaseId // empty") || id=
    if [ -z "$id" ] && [ "$attempt" -lt 10 ]; then
      sleep 3
    fi
  done
  if [ -z "$id" ] || ! gh run watch "$id" --exit-status; then
    failed="$failed $wf"
  fi
done
if [ -n "$failed" ]; then
  printf '::error::re-release failed:%s\n' "$failed"
  exit 1
fi
