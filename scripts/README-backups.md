# Mealio personal backups (Neon Free → Google Drive)

**Status (2026-09-28):** one encrypted production archive was made in the owner's Google Drive for desktop folder, with a matching SHA-256 checksum and a readable encrypted PostgreSQL manifest. **Recurring backups are NOT running.** macOS denied the launchd agent access to `~/Library/CloudStorage`; the failed agent was uninstalled. Do **not** run `install-backup-agent.sh` on this Mac until that access issue is resolved or the job is changed to use a direct Google Drive API upload. The archive's appearance on drive.google.com and a real-data restore remain unverified; synthetic backup/restore tests passed. Neon Free's short PITR history and a one-time old snapshot are not enough to protect future meals. The History PDF is not a restorable backup.

## One-time setup on the owner's Mac

1. Install and sign in to [Google Drive for desktop](https://www.google.com/drive/download/). In Finder, create a dedicated `Mealio encrypted backups` folder inside **My Drive**. Confirm it appears under `~/Library/CloudStorage/GoogleDrive-*/...`, and later verify files appear at [drive.google.com](https://drive.google.com/). Merely having a local folder is **not** proof of cloud sync.
2. Turn on **FileVault** in macOS System Settings → Privacy & Security, and safely keep its recovery key. FileVault is currently off on this Mac; the restore drill refuses private local restores until it is on. Keep the Mac awake/connected regularly. Google Drive for desktop must be signed in and syncing.
3. In Neon Console, copy the **direct/unpooled** connection string for the *production* database. Ensure `sslmode=require` (or stricter). Do not put it in a terminal command line, chat, Git, launchd plist, or Google Drive. Never use a `-pooler` hostname. Neon currently runs PostgreSQL 18, so this Mac uses `brew install postgresql@18` (without starting a service). Upgrade the backup/restore tools if Neon upgrades later.
4. In your own Terminal (from the `code/` folder), run `brew install age` if needed, then `bash scripts/setup-neon-backup.sh`. Paste the Drive folder path and direct URL at the prompts (the URL input is hidden). Private config lives in `~/Library/Application Support/MealioBackup/private/` with owner-only permissions, **outside Git**. If setup is interrupted, inspect and finish/remove only that new private config yourself; the setup script will not overwrite it.
5. Copy `~/Library/Application Support/MealioBackup/private/age-identity.txt` to a **separate, secure offline/password-manager location**. Keep this identity out of Git, the same Google Drive folder, and chat. Without it, encrypted backups cannot be restored. Treat the URL and identity on this Mac as secrets.
6. **Pending:** resolve macOS's Google Drive File Provider access restriction for an unattended backup. The current `launchd` agent cannot read the Google Drive desktop folder, so installing it now would schedule failed attempts, **not backups**. An authenticated direct Google Drive API uploader is a possible replacement but needs a separate one-time Google authorization; do not claim the schedule works before a background run and remote receipt succeed. No credentials should appear in a plist or logs.
7. Check `~/Library/Logs/MealioBackup/backup.out.log` and `backup.err.log`. Confirm today's `Mealio-YYYY-MM-DD.dump.age` **and** `.sha256` actually appear at drive.google.com after syncing, not only on the Mac. Failure, sleep, lack of network, Drive sign-out or out-of-space can delay backups; there is no cloud receipt in this local job. Nothing is auto-deleted; watch Drive storage and revisit retention only after multiple verified restores.

**Until automation is fixed:** `bash scripts/backup-neon.sh` manually from an interactive Terminal each day. It either creates that day's verified encrypted archive or reports why it failed; Terminal may ask for access to Google Drive. Then confirm both files on drive.google.com. This manual step does not replace a tested recurring schedule.

Run `bash scripts/test-backup-neon.sh` to exercise encryption, decryption, checksum, retry and an isolated **synthetic** local restore. This does not access Neon.

## Real restore drill (do before trusting real meal history; repeat monthly)

After FileVault is on, choose a recent `.dump.age` *that is visible/downloaded from drive.google.com*. With your private identity available locally, run:

```sh
bash scripts/verify-neon-restore.sh '/path/to/Mealio-YYYY-MM-DD.dump.age' "$HOME/Library/Application Support/MealioBackup/private/age-identity.txt"
```

This creates a disposable **new** PostgreSQL cluster with a private Unix socket and no TCP listener, decrypts into `pg_restore` without a plaintext dump file, and checks for one owner, meals, the private INDB catalog, snapshot JSON arrays, valid times and timezone. Only aggregate counts are printed; it stops and removes the test cluster. It **never points at or alters production**. Review counts against what you expect from the backup date, including a known corrected meal; the script cannot validate every value automatically. A failed restore must be investigated before relying on the backups.

For disaster recovery, provision a **separate empty** PostgreSQL/Neon project, not the live production branch, and restore there using Neon's [pg_dump/pg_restore guidance](https://neon.com/docs/manage/backup-pg-dump). Only reconnect the app after owner review; restoring a historical copy over the live database would lose all later meals. Keep the encryption identity outside the lost device and check backups after any URL/password rotation.
