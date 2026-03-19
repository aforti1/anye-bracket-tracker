// components/BracketView.tsx
"use client";
import { useMemo, useState, useEffect } from "react";
import type { BracketDetail, PickDetail, Round } from "@/lib/types";

const ROUND_LABELS: Record<Round, string> = {
  round_64: "R64", round_32: "R32", sweet_16: "Sweet 16",
  elite_8: "Elite 8", final_four: "Final 4", championship: "Championship",
};

const REGION_COLOR: Record<string, string> = {
  East: "#3b82f6", West: "#a855f7",
  Midwest: "#f97316", South: "#22c55e",
};

const REGION_ROUNDS: Round[] = ["round_64", "round_32", "sweet_16", "elite_8"];

type Status = "correct" | "wrong" | "in_progress" | "not_started";

function getStatus(pick: PickDetail, liveSet: Set<number>): Status {
  if (pick.correct === true)  return "correct";
  if (pick.correct === false) return "wrong";
  if (liveSet.has(pick.game_idx)) return "in_progress";
  return "not_started";
}

const YELLOW = "#facc15";

interface Props { bracket: BracketDetail; }

export default function BracketView({ bracket }: Props) {
  const [liveSet, setLiveSet] = useState<Set<number>>(new Set());

  // Fetch live game indices on mount
  useEffect(() => {
    fetch("/api/live-games", { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        const idxs: number[] = data.live_game_idxs ?? [];
        setLiveSet(new Set(idxs));
      })
      .catch(() => {});
  }, []);

  const byRegion = useMemo(() => {
    const map = new Map<string, Map<Round, PickDetail[]>>();
    for (const pick of bracket.pick_details) {
      if (!map.has(pick.region)) map.set(pick.region, new Map());
      const byRound = map.get(pick.region)!;
      if (!byRound.has(pick.round)) byRound.set(pick.round, []);
      byRound.get(pick.round)!.push(pick);
    }
    return map;
  }, [bracket.pick_details]);

  const finalFour    = bracket.pick_details.filter(p => p.round === "final_four");
  const championship = bracket.pick_details.find(p => p.round === "championship") ?? null;

  const correct  = bracket.correct_picks;
  const decided  = bracket.games_decided;
  const inProg   = bracket.pick_details.filter(p => p.correct === null && liveSet.has(p.game_idx)).length;
  const upcoming = bracket.pick_details.filter(p => p.correct === null && !liveSet.has(p.game_idx)).length;

  const SLOT_H = 84;

  return (
    <div>
      <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        <Legend color="var(--correct)" label={`Correct (${correct})`} />
        <Legend color="var(--wrong)"   label={`Wrong (${decided - correct})`} />
        <Legend color={YELLOW}         label={`In Progress (${inProg})`} />
        <Legend color="var(--pending)" label={`Not Started (${upcoming})`} />
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "stretch", minWidth: 1500, gap: 0 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <RegionBracket region="East"  byRound={byRegion.get("East")  ?? new Map()} liveSet={liveSet} side="left"  slotH={SLOT_H} />
            <RegionBracket region="South" byRound={byRegion.get("South") ?? new Map()} liveSet={liveSet} side="left"  slotH={SLOT_H} />
          </div>

          <div style={{
            width: 170, flexShrink: 0, display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "stretch", padding: "0 8px",
          }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700,
              letterSpacing: "0.08em", color: "var(--accent)",
              textAlign: "center", marginBottom: 6, textTransform: "uppercase",
            }}>Final Four</div>
            {finalFour[0] && <MatchupCard pick={finalFour[0]} liveSet={liveSet} />}
          </div>

          <div style={{
            width: 180, flexShrink: 0, display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "stretch", padding: "0 10px",
          }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800,
              letterSpacing: "0.08em", color: "var(--accent)",
              textAlign: "center", marginBottom: 8, textTransform: "uppercase",
            }}>Championship</div>
            {championship && <MatchupCard pick={championship} liveSet={liveSet} champion />}
          </div>

          <div style={{
            width: 170, flexShrink: 0, display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "stretch", padding: "0 8px",
          }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700,
              letterSpacing: "0.08em", color: "var(--accent)",
              textAlign: "center", marginBottom: 6, textTransform: "uppercase",
            }}>Final Four</div>
            {finalFour[1] && <MatchupCard pick={finalFour[1]} liveSet={liveSet} />}
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <RegionBracket region="West"    byRound={byRegion.get("West")    ?? new Map()} liveSet={liveSet} side="right" slotH={SLOT_H} />
            <RegionBracket region="Midwest" byRound={byRegion.get("Midwest") ?? new Map()} liveSet={liveSet} side="right" slotH={SLOT_H} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RegionBracket({ region, byRound, liveSet, side, slotH }: {
  region: string; byRound: Map<Round, PickDetail[]>;
  liveSet: Set<number>; side: "left"|"right"; slotH: number;
}) {
  const color  = REGION_COLOR[region] ?? "var(--accent)";
  const rounds = side === "left" ? REGION_ROUNDS : [...REGION_ROUNDS].reverse();

  return (
    <div style={{ flex: 1 }}>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800,
        letterSpacing: "0.04em", color,
        textAlign: side === "right" ? "right" : "left",
        paddingBottom: 6, marginBottom: 8, borderBottom: `2px solid ${color}44`,
      }}>{region}</div>
      <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
        {rounds.map(round => (
          <RoundCol key={round} round={round} picks={byRound.get(round) ?? []} liveSet={liveSet} slotH={slotH} minW={140} />
        ))}
      </div>
    </div>
  );
}

function RoundCol({ round, picks, liveSet, slotH, minW }: {
  round: Round; picks: PickDetail[]; liveSet: Set<number>; slotH: number; minW?: number;
}) {
  const r64Count  = 8;
  const gameCount = picks.length || 1;
  const slotsEach = r64Count / gameCount;

  return (
    <div style={{ flex: 1, minWidth: minW ?? 120 }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.06em",
        color: "var(--text-muted)", textAlign: "center", marginBottom: 6,
      }}>{ROUND_LABELS[round]}</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {picks.map((pick, i) => (
          <div key={i} style={{
            height: slotsEach * slotH, display: "flex", alignItems: "center",
            padding: `${slotsEach * slotH * 0.3}px 0`, boxSizing: "border-box",
          }}>
            <div style={{ width: "100%" }}><MatchupCard pick={pick} liveSet={liveSet} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchupCard({ pick, liveSet, champion }: {
  pick: PickDetail; liveSet: Set<number>; champion?: boolean;
}) {
  const status   = getStatus(pick, liveSet);
  const winnerId = pick.predicted_winner?.team_id;
  const teamA    = pick.team_a;
  const teamB    = pick.team_b;

  if (!teamA || !teamB) return <PickCard pick={pick} liveSet={liveSet} champion={champion} />;

  const borderColor =
      status === "correct"       ? "var(--correct)"
    : status === "wrong"         ? "var(--wrong)"
    : status === "in_progress"   ? `${YELLOW}40`
    : champion                   ? "var(--accent-glow)"
    : "var(--border)";

  return (
    <div style={{
      width: "100%", border: `1px solid ${borderColor}`,
      borderRadius: 5, overflow: "hidden", background: "var(--bg-card)",
    }}>
      <TeamRow team={teamA} isWinner={winnerId === teamA.team_id} status={status} champion={champion} />
      <div style={{ height: 1, background: "var(--border-subtle)" }} />
      <TeamRow team={teamB} isWinner={winnerId === teamB.team_id} status={status} champion={champion} />
    </div>
  );
}

function TeamRow({ team, isWinner, status, champion }: {
  team: { team_id: number; name: string; seed: number; region: string };
  isWinner: boolean; status: Status; champion?: boolean;
}) {
  const useChampionAccent = champion && status === "not_started";

  const winnerBg = useChampionAccent && isWinner ? "var(--accent-dim)"
    : isWinner && status === "correct"     ? "var(--correct-dim)"
    : isWinner && status === "wrong"       ? "var(--wrong-dim)"
    : isWinner && status === "in_progress" ? `${YELLOW}18`
    : isWinner ? "var(--bg-elevated)" : "transparent";

  const nameColor = useChampionAccent && isWinner ? "var(--text-primary)"
    : isWinner && status === "correct"     ? "var(--correct)"
    : isWinner && status === "wrong"       ? "var(--wrong)"
    : isWinner && status === "in_progress" ? YELLOW
    : isWinner ? "var(--text-primary)" : "var(--text-muted)";

  const dotColor = status === "correct" ? "var(--correct)"
    : status === "wrong" ? "var(--wrong)"
    : status === "in_progress" ? YELLOW : "var(--pending)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 8px", background: winnerBg }}>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 11, minWidth: 16,
        textAlign: "right", color: "var(--text-muted)", flexShrink: 0,
      }}>{team.seed}</span>
      <span style={{
        fontFamily: "var(--font-body)", fontSize: 13, fontWeight: isWinner ? 600 : 400,
        color: nameColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
      }}>{team.name}</span>
      {isWinner && (
        <div style={{
          width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: dotColor,
          ...(status === "in_progress" ? { animation: "pulse-live 2s ease-in-out infinite" } : {}),
        }} />
      )}
    </div>
  );
}

function PickCard({ pick, liveSet, champion }: { pick: PickDetail; liveSet: Set<number>; champion?: boolean; }) {
  const status   = getStatus(pick, liveSet);
  const teamName = pick.predicted_winner?.name ?? "TBD";
  const seed     = pick.predicted_winner?.seed;

  const borderColor = status === "correct" ? "var(--correct)"
    : status === "wrong" ? "var(--wrong)"
    : status === "in_progress" ? `${YELLOW}40`
    : champion ? "var(--accent-glow)" : "var(--border)";

  const bg = status === "correct" ? "var(--correct-dim)"
    : status === "wrong" ? "var(--wrong-dim)"
    : status === "in_progress" ? `${YELLOW}18`
    : champion ? "var(--accent-dim)" : "var(--bg-card)";

  return (
    <div style={{
      width: "100%", background: bg, border: `1px solid ${borderColor}`,
      borderRadius: 5, padding: "5px 8px", display: "flex", alignItems: "center", gap: 6,
    }}>
      {seed != null && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, minWidth: 16, textAlign: "right", color: "var(--text-muted)" }}>{seed}</span>
      )}
      <span style={{
        fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 500,
        color: status === "correct" ? "var(--correct)"
          : status === "wrong" ? "var(--text-secondary)"
          : status === "in_progress" ? YELLOW
          : "var(--text-primary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{teamName}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}
