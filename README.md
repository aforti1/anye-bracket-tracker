# the anye bracket tracker

Live tournament bracket tracker for March Madness 2026. Tracks millions of ML-generated brackets against real tournament results in real time.

## What is this?

A portfolio of 1–5 million brackets was generated using an ensemble of XGBoost, LightGBM, and Logistic Regression models trained on 15 years of NCAA tournament data. This site tracks every bracket as the tournament unfolds — updating scores, accuracy, and rankings after each game. I'm still deciding how many brackets I want to generate lmao.

**I'm at least letting y'all see all my generated brackets publicly.** The model training and bracket generation code lives in a separate private repository that I'm gatekeeping. If you somehow find access to it idrc.

## Features

- **Leaderboard** — all brackets ranked by tournament score, sortable and filterable
- **Bracket visualization** — full 64-team bracket view with correct/incorrect/pending picks
- **Live updates** — auto-scrapes game results from ESPN every 15 minutes during game windows
- **Bracket IDs** — every bracket has a unique short ID for easy sharing and lookup
- **Stats** — accuracy, points, upset picks, champion distribution across the portfolio

## Tech stack

- **Next.js 14** (App Router) — fullstack React framework
- **Supabase** (PostgreSQL) — bracket storage and live results
- **Tailwind CSS** — styling
- **Vercel** — deployment + cron jobs for auto-scraping
- **ESPN API** — game result scraping

## Data pipeline

```
Private repo (bracket generation)
  → exports brackets as .parquet
  → seed-db script loads into Supabase

Public repo (this site)
  → reads from Supabase
  → auto-scrapes ESPN for results
  → updates scores in real time
```

## If y'all wanna do this too:

### Prerequisites

- Node.js 18+
- Supabase account (free tier works for development)
- Vercel account (for deployment)

### Local development

```bash
git clone https://github.com/YOUR_USERNAME/bracket-tracker.git
cd bracket-tracker
npm install
cp .env.example .env.local
# Fill in your Supabase credentials in .env.local
npm run dev
```

### Database setup

1. Create a Supabase project
2. Run the schema migration: `npx supabase db push` or execute `supabase/schema.sql` manually
3. Import brackets: `npx tsx scripts/seed-db.ts path/to/export_2026.parquet`

### Deployment

```bash
vercel deploy
```

Set the following environment variables in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

## Schema

| Table | Rows | Description |
|---|---|---|
| `brackets` | 1–5M | One row per bracket with picks stored as `smallint[63]` |
| `game_results` | 0–63 | Filled in as games complete |
| `tournament_teams` | 68 | Team names, seeds, regions |

## How scoring works for my non-basketball ppl

Standard ESPN bracket scoring:
- Round of 64: 10 pts per correct pick
- Round of 32: 20 pts
- Sweet 16: 40 pts
- Elite Eight: 80 pts
- Final Four: 160 pts
- Championship: 320 pts

Maximum possible score: 1920 points.

## License

MIT
