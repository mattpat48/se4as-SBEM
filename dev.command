#!/bin/sh
# macOS launcher for dev.py: double-click it in Finder, or run ./dev.command
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 dev.py "$@"
elif command -v uv >/dev/null 2>&1; then
  exec uv run --no-project --python 3.11 python dev.py "$@"
else
  echo "Serve Python 3.9+ (o uv): https://www.python.org/downloads/"
  read -r _
  exit 1
fi
