import json, urllib.request
from datetime import datetime, timedelta

MENS_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100"
WOMENS_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?groups=100&limit=100"

today = datetime.now().strftime("%Y%m%d")
yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")

def fetch_events(base_url, dates):
    all_events = []
    seen_ids = set()
    for d in dates:
        url = f"{base_url}&dates={d}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
        for e in data.get("events", []):
            if e["id"] not in seen_ids:
                seen_ids.add(e["id"])
                all_events.append(e)
    return all_events

def print_games(events, label):
    completed = []
    in_progress = []
    scheduled = []

    for e in events:
        comp = e.get("competitions", [{}])[0]
        teams = comp.get("competitors", [])
        notes = comp.get("notes", [])
        round_str = notes[0]["headline"] if notes else "?"
        state = e.get("status", {}).get("type", {}).get("state", "?")
        is_done = e.get("status", {}).get("type", {}).get("completed", False)

        t1 = teams[0]["team"]["displayName"] if len(teams) > 0 else "?"
        t2 = teams[1]["team"]["displayName"] if len(teams) > 1 else "?"
        s1 = teams[0].get("score", "?") if len(teams) > 0 else "?"
        s2 = teams[1].get("score", "?") if len(teams) > 1 else "?"

        if is_done:
            w = next((c for c in teams if c.get("winner")), None)
            winner = w["team"]["displayName"] if w else "?"
            completed.append({"team1": t1, "score1": s1, "team2": t2, "score2": s2, "winner": winner, "round": round_str})
        elif state == "in":
            detail = e.get("status", {}).get("type", {}).get("shortDetail", "")
            in_progress.append({"team1": t1, "score1": s1, "team2": t2, "score2": s2, "detail": detail, "round": round_str})
        else:
            detail = e.get("status", {}).get("type", {}).get("shortDetail", "")
            scheduled.append({"team1": t1, "team2": t2, "detail": detail, "round": round_str})

    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"{'='*70}")
    print(f"  Completed: {len(completed)}  |  In Progress: {len(in_progress)}  |  Scheduled: {len(scheduled)}")

    print(f"\n  COMPLETED ({len(completed)}):")
    for i, g in enumerate(completed, 1):
        print(f"    {i:2}. {g['winner']:<35} ({g['team1']} {g['score1']} - {g['score2']} {g['team2']})")
        print(f"        {g['round']}")

    if in_progress:
        print(f"\n  IN PROGRESS ({len(in_progress)}):")
        for g in in_progress:
            print(f"    • {g['team1']} {g['score1']} - {g['score2']} {g['team2']}  [{g['detail']}]")

    if scheduled:
        print(f"\n  SCHEDULED ({len(scheduled)}):")
        for g in scheduled:
            print(f"    • {g['team1']} vs {g['team2']}  [{g['detail']}]")

    return completed

dates = [yesterday, today]
print(f"Fetching ESPN data for {yesterday} and {today}...\n")

mens_events = fetch_events(MENS_BASE, dates)
womens_events = fetch_events(WOMENS_BASE, dates)

mens = print_games(mens_events, "MEN'S TOURNAMENT")
womens = print_games(womens_events, "WOMEN'S TOURNAMENT")