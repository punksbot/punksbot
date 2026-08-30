#!/bin/sh
set -eu

python3 /tests/verify.py \
  --evidence /logs/artifacts/punks-evidence.json \
  --skill-file /home/punks/.claude/skills/context-health-check/SKILL.md \
  --reward /logs/verifier/reward.json \
  --details /logs/verifier/details.json
