#!/usr/bin/env bash
# Waits for a server to answer, or gives up.
#
# Usage: wait-for-server.sh [<url>] [<seconds>]
#
# A fixed sleep is a guess: too short and Playwright starts against a socket
# nothing is listening on, too long and every pipeline pays for it.
set -euo pipefail

url="${1:-http://127.0.0.1:3000/}"
deadline=$(( SECONDS + ${2:-30} ))

# --connect-timeout and --max-time: a socket that accepts and then says nothing
# would otherwise hold the probe open past the deadline this loop enforces.
until curl -sf --connect-timeout 2 --max-time 5 -o /dev/null "$url"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "No answer from ${url} within ${2:-30}s." >&2
    exit 1
  fi
  sleep 0.5
done
echo "${url} is answering."
