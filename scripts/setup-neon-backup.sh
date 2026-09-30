#!/usr/bin/env bash
# Run interactively on the owner's Mac AFTER signing into Google Drive for desktop.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$HOME/Library/Application Support/MealioBackup"
CONFIG="$APP/private"
[[ -t 0 ]] || { echo "Run this in your own interactive Terminal, not a remote shell." >&2; exit 1; }
[[ ! -e "$CONFIG" ]] || { echo "Backup config already exists; nothing overwritten." >&2; exit 1; }
command -v age-keygen >/dev/null || { echo "Install age first: brew install age" >&2; exit 1; }
mkdir -p "$APP"
chmod 700 "$APP"
mkdir -m 700 "$CONFIG"
read -r -p 'Paste the full Google Drive for desktop folder path: ' drive
case "$drive" in "$HOME"/Library/CloudStorage/GoogleDrive-*/*) : ;; *) echo "That is not a Google Drive for desktop folder." >&2; exit 1 ;; esac
[[ -d "$drive" && -w "$drive" && ! -L "$drive" ]] || { echo "Drive folder is not currently mounted and writable." >&2; exit 1; }
printf '%s\n' "$drive" > "$CONFIG/drive-folder.txt"
unset drive
read -r -s -p 'Paste the direct (unpooled) Neon URL with sslmode=require (input hidden): ' url
printf '\n'
[[ "$url" == postgresql://* || "$url" == postgres://* ]] || { echo "Invalid URL type. No backup installed." >&2; exit 1; }
printf '%s\n' "$url" > "$CONFIG/neon-direct-url.txt"
unset url
age-keygen -o "$CONFIG/age-identity.txt" >/dev/null 2>&1
age-keygen -y "$CONFIG/age-identity.txt" > "$CONFIG/age-recipient.txt"
chmod 600 "$CONFIG/"*.txt
echo "Private configuration created in your Application Support folder. Back up the decryption identity offline (not beside the Drive archives), then run: bash scripts/install-backup-agent.sh"
echo "Do not delete or share the identity; without it the Drive archives cannot be restored."
