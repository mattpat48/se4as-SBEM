#!/usr/bin/env bash
# Linux launcher for dev.py: run ./dev.sh from a terminal

# Change to the directory where the script is located
cd "$(dirname "$0")" || exit

if command -v python3 >/dev/null 2>&1; then
    python3 dev.py "$@"
elif command -v python >/dev/null 2>&1; then
    python dev.py "$@"
elif command -v uv >/dev/null 2>&1; then
    uv run --no-project --python 3.11 python dev.py "$@"
else
    echo "Serve Python 3.9+ (o uv): https://www.python.org/downloads/"
    read -p "Premi Invio per uscire..."
fi
