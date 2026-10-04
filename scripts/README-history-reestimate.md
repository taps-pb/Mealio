# Owner-requested history nutrition updates

This is an explicit maintenance operation, never an automatic response to a
catalog update. Publish the matching app first so its API can read/edit the new
versioned snapshots.

```sh
# Preview only; --library supplies a private export with clarified food mappings.
node --env-file=.env.local --import tsx scripts/reestimate-history.ts \
  --library /private/owner-food-library.json --include-corrected --require-all

# Execute the reviewed recalculation of all meals, including manual corrections.
node --env-file=.env.local --import tsx scripts/reestimate-history.ts \
  --library /private/owner-food-library.json --include-corrected --require-all --apply
```

- Omitting `--apply` never writes to the database. Omitting `--include-corrected`
  protects manual corrections. `--require-all` refuses the entire operation if
  any record cannot resolve; unknown items never become zero calories.
- Food resolution uses only the bundled local catalog and supplied private user
  library. Database networking is solely for reading/writing the owner's records.
- Keep the normal encrypted database backup. The utility additionally encrypts
  exact before/after meal rows and the supplied library with the existing backup
  identity, verifies decryption and SHA256, and saves outside Git under the
  private backup configuration's `history-reestimates/` directory. It never
  writes meal history or credentials to plaintext logs.
- Application is one serializable transaction with row locks, before-state
  fingerprint checks and post-write verification. SQL updates only nutrient
  totals, item snapshots, provenance and `updated_at`. Original descriptions,
  meal IDs, owner IDs, eaten-at times, creation times and idempotency keys are
  verified unchanged. There are no row inserts or deletes.
- Repeating the same run is idempotent. The private receipt identifies the
  dataset version, counts and before/after fingerprints without exposing meals.

Undo a revision only if history still matches its exact post-update state:

```sh
node --env-file=.env.local --import tsx scripts/reestimate-history.ts \
  --restore /private/revision.json.age --apply
```

Undo restores original nutrition/snapshots in place and rejects intervening
changes rather than overwriting newer edits or deleting newer meals. Retain the
encrypted archive, its checksum and the separate private age identity. Owner
mapping/library exports are private and must not be committed.
