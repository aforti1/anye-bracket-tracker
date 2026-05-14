# External picks storage — operator runbook

The `picks` column in `brackets` and `w_brackets` accounts for ~143 MB per
table. To fit Supabase's 500 MB free tier during the off-season, picks are
moved to a packed binary file in Vercel Blob. The Supabase column stays in
place during the cutover and is only dropped manually after the blob path
has been stable in production for 24–48 hours.

The runtime selects between Supabase and Blob via the `PICKS_SOURCE` env
var. Default is `supabase` (legacy); set to `blob` to use the new path.

## Architecture

- **Storage**: one binary file per gender in Vercel Blob
  (`picks_mens.bin`, `picks_womens.bin`).
- **Layout**: 63 little-endian uint16 picks per bracket, sorted by Supabase
  `id` ascending. Record N (1-indexed) starts at byte offset `(N-1) * 126`.
- **Total size**: 126 MB per gender (1M brackets × 126 bytes).
- **Reversibility**: `(file_size, file_size / 126)` is the row count;
  reading record N is `read 126 bytes at (N-1)*126`. To re-import to
  Supabase trivially, run a script that maps id → 126-byte slice → Postgres
  SMALLINT[] insert.

## Required env vars

| Var | Purpose | Used by |
|---|---|---|
| `PICKS_SOURCE` | `supabase` (default) or `blob` — feature flag | All routes |
| `PICKS_BLOB_URL_MENS` | Public URL of `picks_mens.bin` in Vercel Blob | Runtime + parity |
| `PICKS_BLOB_URL_WOMENS` | Public URL of `picks_womens.bin` | Runtime + parity |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob write token (only for `blob:export` script) | Operator |

## One-time setup

1. **Create the Vercel Blob store** (Vercel dashboard → Storage → Create
   Database → Blob). This issues a `BLOB_READ_WRITE_TOKEN` — copy it into
   your local `.env`.
2. **Install the dependency**:
   ```
   npm install
   ```
   (adds `@vercel/blob`).

## Migration steps

Run from the **main repo checkout** (the one on `ext-picks-storage`),
not from the worktree. The scripts read the Parquet files from
`../march-madness-bracket-predictor/outputs[_w]/brackets/export_2026.parquet`.

### 1. Add the `perfect_streak` column

Run `supabase/migrations/001_add_perfect_streak.sql` in the Supabase SQL
editor. Idempotent.

### 2. Backfill `perfect_streak` from Parquet

```
npm run backfill:streak                 # both genders
npm run backfill:streak -- --gender mens   # one
npm run backfill:streak -- --dry-run       # validate only
```

The script reads picks from the source Parquet (NOT from Supabase's picks
column), computes streak against the live `game_results` ordering, and
writes to the new column in 500-row chunks. Prints a histogram for
sanity-checking; should show high counts at low streak values and a long
tail to higher values.

### 3. Generate and upload the binary files

```
npm run blob:export             # writes data/picks_*.bin AND uploads to Vercel Blob
npm run blob:export -- --no-upload   # writes locally only
```

Output: prints two URLs (one per gender). Set them as
`PICKS_BLOB_URL_MENS` / `PICKS_BLOB_URL_WOMENS` in your Vercel env.

The script also spot-checks 5 random records against the Supabase column
before writing.

### 4. Run parity tests

Both run against your local `.env`. The blob must already be uploaded
(`PICKS_BLOB_URL_MENS` / `PICKS_BLOB_URL_WOMENS` populated) — `parity:filter`
imports the production scan helper directly via the `@/lib/...` alias and
exercises the same blob fetch the deployed function will.

```
npm run parity:detail              # 1000 random brackets, byte-for-byte equality
npm run parity:filter              # 20 random pick predicates, RPC vs scan
```

Both must finish with `✅`.

### 5. Switch the flag in preview

In Vercel project settings, set `PICKS_SOURCE=blob` for the **Preview**
environment only. Redeploy a preview branch.

Click through every page type:
- Bracket detail, mens (top + low rank)
- Bracket detail, womens (top + low rank)
- Leaderboard normal sort
- Leaderboard with champion filter
- Leaderboard with upset filter
- Advanced/pick filter (mens + womens)
- Pagination through several pages

### 6. STOP and report back

Do not flip production yet. Report results.

### 7. Production rollout (manual, later)

When the user is ready: set `PICKS_SOURCE=blob` in Production env, redeploy.

After 24–48 hours of clean prod logs, manually drop the column:
```sql
ALTER TABLE brackets   DROP COLUMN picks;
ALTER TABLE w_brackets DROP COLUMN picks;
```

## Rollback

Set `PICKS_SOURCE=supabase` in env and redeploy. As long as the column has
not been dropped, this is instantaneous and complete. Once the column is
dropped, rollback requires re-importing picks (via either the Parquet seed
script or a new "blob → Supabase" script).

## Cold-start tradeoff (filter scan)

The pick-filter scan (`scanFilteredIds`) loads the entire 126 MB blob into
module-level memory on first invocation. Vercel serverless functions
preserve module state across warm invocations on the same instance, so
subsequent filter runs reuse the buffer for free.

Cold-start cost: roughly 1–3 seconds to download 126 MB from Vercel Blob.
The leaderboard UI already shows a "Filtering 1M brackets..." overlay
during pick-filter operations, which absorbs this cost. Subsequent filter
runs on the same warm instance complete in ~1 second for a full 1M scan.
