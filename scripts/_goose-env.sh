#!/usr/bin/env bash
# Sourced by the goose and goose-bg just recipes to build shared agent env_args.
# Usage: source scripts/_goose-env.sh <relay> <key> <agents> <heartbeat> <prompt>
# Sets: env_args (bash array), ready for: exec env "${env_args[@]}" <binary>
set -euo pipefail

_relay="$1"
_key="$2"
_agents="$3"
_heartbeat="$4"
_prompt="${5:-}"

cargo build --release -p punks-acp -p punks-cli

env_args=(
    PUNKS_RELAY_URL="$_relay"
    PUNKS_PRIVATE_KEY="$_key"
    PUNKS_ACP_AGENT_COMMAND=goose
    PUNKS_ACP_AGENT_ARGS=acp
    PUNKS_ACP_AGENTS="$_agents"
    GOOSE_MODE=auto
)
[[ -n "$_prompt" ]] && env_args+=(PUNKS_ACP_SYSTEM_PROMPT="$_prompt")
if [[ "$_heartbeat" != "0" ]]; then
    env_args+=(PUNKS_ACP_HEARTBEAT_INTERVAL="$_heartbeat")
fi
