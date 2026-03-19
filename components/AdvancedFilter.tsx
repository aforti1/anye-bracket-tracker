// components/AdvancedFilter.tsx
"use client";
import { useState, useEffect, useMemo, useRef } from "react";

interface GameNode {
  game_idx: number; round: string; region: string; slot: number;
  team_a_id: number | null; team_b_id: number | null;
  source_a: number | null; source_b: number | null;
}
interface Team { team_id: number; name: string; seed: number; region: string; }
interface PickFilter { game_idx: number; team_id: number; won: boolean; }
interface Props { pickFilters: PickFilter[]; onApply: (filters: PickFilter[]) => void; onClose: () => void; }

const ROUND_SHORT: Record<string, string> = { round_64: "R64", round_32: "R32", sweet_16: "S16", elite_8: "E8", final_four: "FF", championship: "CH" };
const REGION_COLOR: Record<string, string> = { East: "#3b82f6", West: "#a855f7", Midwest: "#f97316", South: "#22c55e" };
const REGION_ROUNDS = ["round_64", "round_32", "sweet_16", "elite_8"];

export default function AdvancedFilter({ pickFilters, onApply, onClose }: Props) {
  const [nodes, setNodes] = useState<GameNode[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<PickFilter[]>(pickFilters);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/game-nodes").then(r => r.json()).catch(() => []),
      fetch("/api/teams").then(r => r.json()).catch(() => []),
    ]).then(([n, t]) => { setNodes(n); setTeams(t); setLoading(false); });
  }, []);

  const teamMap = useMemo(() => new Map(teams.map(t => [t.team_id, t])), [teams]);
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.game_idx, n])), [nodes]);

  // Get all downstream games (games that this game feeds into)
  const getDownstreamGames = useMemo(() => (gi: number): Set<number> => {
    const ds = new Set<number>();
    const q = [gi];
    while (q.length) {
      const cur = q.shift()!;
      for (const [idx, n] of nodeMap) {
        if ((n.source_a === cur || n.source_b === cur) && !ds.has(idx)) { ds.add(idx); q.push(idx); }
      }
    }
    return ds;
  }, [nodeMap]);

  // Get all upstream games (games whose winners feed into this game)
  const getUpstreamGames = useMemo(() => (gi: number): Set<number> => {
    const us = new Set<number>();
    const q = [gi];
    while (q.length) {
      const cur = q.shift()!;
      const n = nodeMap.get(cur);
      if (!n) continue;
      if (n.source_a != null && !us.has(n.source_a)) { us.add(n.source_a); q.push(n.source_a); }
      if (n.source_b != null && !us.has(n.source_b)) { us.add(n.source_b); q.push(n.source_b); }
    }
    return us;
  }, [nodeMap]);

  // Structurally possible teams at a game (from bracket tree leaves)
  const getStructuralTeams = useMemo(() => {
    const cache = new Map<number, Set<number>>();
    const compute = (gi: number): Set<number> => {
      if (cache.has(gi)) return cache.get(gi)!;
      const n = nodeMap.get(gi);
      if (!n) return new Set();
      if (n.round === "round_64") {
        const ids = new Set<number>();
        if (n.team_a_id) ids.add(n.team_a_id);
        if (n.team_b_id) ids.add(n.team_b_id);
        cache.set(gi, ids); return ids;
      }
      const ids = new Set<number>();
      if (n.source_a != null) for (const id of compute(n.source_a)) ids.add(id);
      if (n.source_b != null) for (const id of compute(n.source_b)) ids.add(id);
      cache.set(gi, ids); return ids;
    };
    return compute;
  }, [nodeMap]);

  // Which "side" (source_a or source_b) can a team come from at a game?
  const teamComesFromSide = useMemo(() => (gi: number, tid: number): "a" | "b" | null => {
    const n = nodeMap.get(gi);
    if (!n) return null;
    if (n.round === "round_64") {
      if (n.team_a_id === tid) return "a";
      if (n.team_b_id === tid) return "b";
      return null;
    }
    if (n.source_a != null && getStructuralTeams(n.source_a).has(tid)) return "a";
    if (n.source_b != null && getStructuralTeams(n.source_b).has(tid)) return "b";
    return null;
  }, [nodeMap, getStructuralTeams]);

  /**
   * Get valid teams for the "won" dropdown at a game, respecting ALL filter implications:
   *
   * 1. Start with structurally possible teams
   * 2. LOST filter at this game or downstream → exclude team from here
   * 3. WON filter at a downstream game → that team MUST pass through here,
   *    so the opposing side's teams are all blocked at this game.
   *    Also, at this specific game, only the winning team can be "won".
   * 4. WON filter at THIS game → slot is taken (return empty, or just that team)
   */
  const getValidTeams = useMemo(() => (gi: number): Team[] => {
    const structural = new Set(getStructuralTeams(gi));
    const excluded = new Set<number>();

    for (const f of filters) {
      // Rule: if team lost at game X, exclude from X and all downstream games
      if (!f.won) {
        const ds = getDownstreamGames(f.game_idx);
        if (f.game_idx === gi || ds.has(gi)) excluded.add(f.team_id);
      }

      // Rule: if team WON at game X (downstream of gi), that team must pass through gi.
      // At gi, the opposing side's teams can't win (because winning team's side must win).
      if (f.won) {
        const ds = getDownstreamGames(gi);
        if (ds.has(f.game_idx)) {
          // f.game_idx is downstream of gi → the winning team must come through gi
          // Find which side the winning team comes from at gi
          const side = teamComesFromSide(gi, f.team_id);
          if (side) {
            const node = nodeMap.get(gi);
            if (node) {
              // Exclude ALL teams from the opposing side — they must lose to the winning team's side
              const oppSource = side === "a" ? node.source_b : node.source_a;
              if (oppSource != null) {
                for (const tid of getStructuralTeams(oppSource)) excluded.add(tid);
              }
            }
          }
        }

        // Rule: if team WON at THIS game, no other team can also "won" here
        if (f.game_idx === gi) {
          for (const tid of structural) {
            if (tid !== f.team_id) excluded.add(tid);
          }
        }
      }
    }

    return Array.from(structural).filter(id => !excluded.has(id))
      .map(id => teamMap.get(id)).filter((t): t is Team => !!t)
      .sort((a, b) => a.seed - b.seed);
  }, [teamMap, filters, getStructuralTeams, getDownstreamGames, teamComesFromSide, nodeMap]);

  const filterMap = useMemo(() => new Map(filters.map(f => [f.game_idx, f])), [filters]);
  const addFilter = (gi: number, tid: number, won: boolean) => {
    setFilters(p => [...p.filter(f => f.game_idx !== gi), { game_idx: gi, team_id: tid, won }]);
    setActiveSlot(null); setSelectedTeam(null);
  };
  const removeFilter = (gi: number) => setFilters(p => p.filter(f => f.game_idx !== gi));

  const regionRounds = useMemo(() => {
    const m = new Map<string, Map<string, GameNode[]>>();
    for (const n of nodes) {
      if (!m.has(n.region)) m.set(n.region, new Map());
      const br = m.get(n.region)!;
      if (!br.has(n.round)) br.set(n.round, []);
      br.get(n.round)!.push(n);
    }
    for (const [, br] of m) for (const [, g] of br) g.sort((a, b) => a.slot - b.slot);
    return m;
  }, [nodes]);

  const regionOrder = useMemo(() => {
    const r: string[] = [];
    for (const n of nodes) if (n.round === "round_64" && !r.includes(n.region)) r.push(n.region);
    return r;
  }, [nodes]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (modalRef.current && !modalRef.current.contains(e.target as Node)) { setActiveSlot(null); setSelectedTeam(null); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const SZ = 34; const COL_GAP = 8; const ROW_GAP = 6;

  const renderSlotButton = (node: GameNode) => {
    const filter = filterMap.get(node.game_idx);
    const isActive = activeSlot === node.game_idx;
    let bg = "var(--bg-elevated)", border = "1px solid var(--border)";
    let content: React.ReactNode = null;
    if (filter) {
      const team = teamMap.get(filter.team_id);
      bg = filter.won ? "var(--correct-dim)" : "var(--wrong-dim)";
      border = filter.won ? "1px solid var(--correct)" : "1px solid var(--wrong)";
      content = <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", color: filter.won ? "var(--correct)" : "var(--wrong)", lineHeight: 1, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: SZ - 6 }}>{team ? team.name.substring(0, 3).toUpperCase() : "?"}</span>;
    }
    return (
      <div key={node.game_idx} style={{ position: "relative" }}>
        <button onClick={e => { e.stopPropagation(); if (filter) removeFilter(node.game_idx); else { setActiveSlot(isActive ? null : node.game_idx); setSelectedTeam(null); } }}
          title={`Game ${node.game_idx} (${ROUND_SHORT[node.round]})`}
          style={{ width: SZ, height: SZ, borderRadius: 8, background: bg, border, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "all 0.15s", outline: isActive ? "2px solid var(--accent)" : "none", outlineOffset: 1 }}>
          {content}
        </button>
        {isActive && !selectedTeam && (() => {
          const valid = getValidTeams(node.game_idx);
          return (
            <div style={{ position: "absolute", top: SZ + 4, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 4, zIndex: 100, maxHeight: 220, overflowY: "auto", width: 190, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", padding: "4px 8px", letterSpacing: "0.08em", textTransform: "uppercase" }}>Select team</div>
              {valid.length === 0
                ? <div style={{ padding: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>No valid teams</div>
                : valid.map(t => (
                  <button key={t.team_id} onClick={e => { e.stopPropagation(); setSelectedTeam(t.team_id); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 8px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 4, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-primary)", textAlign: "left" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-elevated)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", minWidth: 16, textAlign: "right" }}>{t.seed}</span>{t.name}
                  </button>
                ))}
            </div>
          );
        })()}
        {isActive && selectedTeam && (
          <div style={{ position: "absolute", top: SZ + 4, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 8, zIndex: 100, width: 170, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>{teamMap.get(selectedTeam)?.name ?? "?"}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={e => { e.stopPropagation(); addFilter(node.game_idx, selectedTeam, true); }} style={{ flex: 1, padding: "6px 0", borderRadius: 6, border: "1px solid var(--correct)", background: "var(--correct-dim)", color: "var(--correct)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Won ✓</button>
              <button onClick={e => { e.stopPropagation(); addFilter(node.game_idx, selectedTeam, false); }} style={{ flex: 1, padding: "6px 0", borderRadius: 6, border: "1px solid var(--wrong)", background: "var(--wrong-dim)", color: "var(--wrong)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Lost ✗</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderRegion = (region: string, side: "left" | "right") => {
    const byRound = regionRounds.get(region);
    if (!byRound) return null;
    const rounds = side === "left" ? REGION_ROUNDS : [...REGION_ROUNDS].reverse();
    const color = REGION_COLOR[region] ?? "var(--text-muted)";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 12, fontWeight: 700, color, letterSpacing: "0.06em", textAlign: side === "left" ? "left" : "right", paddingBottom: 2 }}>{region}</div>
        <div style={{ display: "flex", gap: COL_GAP, flexDirection: "row" }}>
          {rounds.map(round => {
            const games = byRound.get(round) ?? [];
            const spacing = 8 / (games.length || 1);
            return <div key={round} style={{ display: "flex", flexDirection: "column", gap: 0 }}>{games.map(n => <div key={n.game_idx} style={{ height: spacing * (SZ + ROW_GAP), display: "flex", alignItems: "center" }}>{renderSlotButton(n)}</div>)}</div>;
          })}
        </div>
      </div>
    );
  };

  if (loading) return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Loading bracket structure...</div></div>;

  const leftRegions = regionOrder.slice(0, 2);
  const rightRegions = regionOrder.slice(2, 4);
  const ffGames = nodes.filter(n => n.round === "final_four").sort((a, b) => a.slot - b.slot);
  const champGame = nodes.find(n => n.round === "championship");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div ref={modalRef} onClick={e => e.stopPropagation()} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, maxWidth: 1000, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.02em" }}>ADVANCED FILTER</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Click a slot to filter by team. Click a colored slot to remove it.</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, overflowX: "auto", padding: "8px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{leftRegions.map(r => <div key={r}>{renderRegion(r, "left")}</div>)}</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: ROW_GAP, justifyContent: "center" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>FF</div>
            {ffGames[0] && renderSlotButton(ffGames[0])}
            <div style={{ height: 12 }} />
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase" }}>CH</div>
            {champGame && renderSlotButton(champGame)}
            <div style={{ height: 12 }} />
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase" }}>FF</div>
            {ffGames[1] && renderSlotButton(ffGames[1])}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{rightRegions.map(r => <div key={r}>{renderRegion(r, "right")}</div>)}</div>
        </div>
        {filters.length > 0 && (
          <div style={{ marginTop: 16, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Active conditions ({filters.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {filters.map(f => { const team = teamMap.get(f.team_id); const node = nodeMap.get(f.game_idx); return <span key={f.game_idx} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 4, background: f.won ? "var(--correct-dim)" : "var(--wrong-dim)", border: `1px solid ${f.won ? "var(--correct)" : "var(--wrong)"}`, fontFamily: "var(--font-mono)", fontSize: 11, color: f.won ? "var(--correct)" : "var(--wrong)" }}>{team?.name ?? "?"} {f.won ? "won" : "lost"} {ROUND_SHORT[node?.round ?? ""] ?? ""}<button onClick={() => removeFilter(f.game_idx)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "inherit", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>✕</button></span>; })}
            </div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          {filters.length > 0 && <button onClick={() => setFilters([])} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>Clear All</button>}
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)" }}>Cancel</button>
          <button onClick={() => onApply(filters)} style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "8px 20px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--bg-primary)" }}>Apply Filter</button>
        </div>
      </div>
    </div>
  );
}
