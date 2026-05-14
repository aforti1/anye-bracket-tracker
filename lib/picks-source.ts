// lib/picks-source.ts
//
// Single feature-flag boundary for the picks-storage migration.
//
// PICKS_SOURCE env var controls where picks come from:
//   "supabase" (default) — read picks column from Postgres, original behavior.
//   "blob"               — read picks from Vercel Blob via lib/picks-blob.ts;
//                          leaderboard routes skip the picks fetch entirely
//                          and rely on the precomputed perfect_streak column.
//
// Routes call picksSourceMode() once and branch on the result. Keeping the
// flag in one place means rollback is just an env-var flip.

export type PicksSource = "supabase" | "blob";

export function picksSourceMode(): PicksSource {
  const v = (process.env.PICKS_SOURCE ?? "supabase").toLowerCase();
  return v === "blob" ? "blob" : "supabase";
}
