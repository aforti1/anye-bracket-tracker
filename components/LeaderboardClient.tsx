// components/LeaderboardClient.tsx
"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { BracketRow, TournamentSummary } from "@/lib/types";
import AdvancedFilter from "@/components/AdvancedFilter";

interface Champion { team_id: number; name: string; seed: number; count: number; }
interface Props { summary: TournamentSummary; champions: Champion[]; }

function smartNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${parseFloat(k.toFixed(2))}K`;
  }
  const m = n / 1_000_000;
  return m % 1 === 0 ? `${m}M` : `${parseFloat(m.toFixed(2))}M`;
}

const COLUMNS = [
  { key: "rank",            label: "Rank",            sortable: true },
  { key: "bracket_hash",    label: "Bracket ID",      sortable: true },
  { key: "champion_name",   label: "Champion",        sortable: true },
  { key: "total_points",    label: "Points",          sortable: true },
  { key: "max_points",      label: "Max Points",      sortable: false },
  { key: "correct_picks",   label: "Correct",         sortable: true },
  { key: "perfect_streak",  label: "Perfect Streak",  sortable: true },
  { key: "upset_count",     label: "Upsets",           sortable: true },
];

function LeaderboardInner({ summary: serverSummary, champions: serverChampions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [summary, setSummary] = useState(serverSummary);
  const [champions, setChampions] = useState(serverChampions);

  useEffect(() => {
    fetch("/api/summary", { cache: "no-store" }).then(r => r.json()).then(setSummary).catch(() => {});
    fetch("/api/champions", { cache: "no-store" }).then(r => r.json()).then(setChampions).catch(() => {});
  }, []);

  const [page, setPage]               = useState(() => parseInt(searchParams.get("page") ?? "1"));
  const [sort, setSort]               = useState(() => searchParams.get("sort") ?? "total_points");
  const [order, setOrder]             = useState<"asc" | "desc">(() => (searchParams.get("order") as "asc" | "desc") ?? "desc");
  const [champFilter, setChampFilter] = useState(() => searchParams.get("champion_id") ?? "");
  const [minUpsets, setMinUpsets]     = useState(() => searchParams.get("min_upsets") ?? "");
  const [maxUpsets, setMaxUpsets]     = useState(() => searchParams.get("max_upsets") ?? "");
  const [pickFilters, setPickFilters] = useState<{ game_idx: number; team_id: number; won: boolean }[]>(() => {
    try { return JSON.parse(searchParams.get("picks") ?? "[]"); } catch { return []; }
  });

  const [brackets, setBrackets]       = useState<BracketRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [totalPages, setTotalPages]   = useState(1);
  const [total, setTotal]             = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isInitialMount = useRef(true);

  // When pick filters active, disable champion dropdown
  useEffect(() => {
    if (pickFilters.length > 0 && champFilter) setChampFilter("");
  }, [pickFilters]);

  // Sync state → URL using history API (NO router.replace)
  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (sort !== "total_points") params.set("sort", sort);
    if (order !== "desc") params.set("order", order);
    if (champFilter) params.set("champion_id", champFilter);
    if (minUpsets) params.set("min_upsets", minUpsets);
    if (maxUpsets) params.set("max_upsets", maxUpsets);
    if (pickFilters.length > 0) params.set("picks", JSON.stringify(pickFilters));
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [page, sort, order, champFilter, minUpsets, maxUpsets, pickFilters, pathname]);

  const fetchBrackets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page), per_page: "50", sort, order,
      ...(champFilter && pickFilters.length === 0 && { champion_id: champFilter }),
      ...(minUpsets && { min_upsets: minUpsets }),
      ...(maxUpsets && { max_upsets: maxUpsets }),
    });
    if (pickFilters.length > 0) params.set("pick_filters", JSON.stringify(pickFilters));
    const res = await fetch(`/api/brackets?${params}`);
    const data = await res.json();
    setBrackets(data.brackets ?? []);
    setTotalPages(data.total_pages ?? 1);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [page, sort, order, champFilter, minUpsets, maxUpsets, pickFilters]);

  useEffect(() => { fetchBrackets(); }, [fetchBrackets]);

  // Helper: apply a filter change + reset sort to rank asc + page 1
  const applyFilterChange = (updates: {
    champ?: string; minUp?: string; maxUp?: string; picks?: typeof pickFilters;
  }) => {
    if (updates.champ !== undefined) setChampFilter(updates.champ);
    if (updates.minUp !== undefined) setMinUpsets(updates.minUp);
    if (updates.maxUp !== undefined) setMaxUpsets(updates.maxUp);
    if (updates.picks !== undefined) setPickFilters(updates.picks);

    // Check if any filter will be active after this change
    const willHaveChamp = updates.champ !== undefined ? updates.champ : champFilter;
    const willHaveMinUp = updates.minUp !== undefined ? updates.minUp : minUpsets;
    const willHaveMaxUp = updates.maxUp !== undefined ? updates.maxUp : maxUpsets;
    const willHavePicks = updates.picks !== undefined ? updates.picks : pickFilters;
    const anyFilterActive = willHaveChamp || willHaveMinUp || willHaveMaxUp || willHavePicks.length > 0;

    if (anyFilterActive) {
      setSort("rank");
      setOrder("asc");
    }
    setPage(1);
  };

  const clearAllFilters = () => {
    setChampFilter(""); setMinUpsets(""); setMaxUpsets(""); setPickFilters([]);
    setSort("total_points"); setOrder("desc"); setPage(1);
  };

  const toggleSort = (key: string) => {
    if (sort === key) setOrder(o => o === "desc" ? "asc" : "desc");
    else { setSort(key); setOrder(key === "rank" ? "asc" : "desc"); }
    setPage(1);
  };

  const numStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500, color: "var(--text-primary)",
  };
  const champFilterDisabled = pickFilters.length > 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em" }}>FILTER:</span>
        <select value={champFilter}
          onChange={e => applyFilterChange({ champ: e.target.value })}
          disabled={champFilterDisabled}
          style={{ ...selectStyle, ...(champFilterDisabled ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}
          suppressHydrationWarning>
          <option value="">All Champions ({smartNum(summary.unique_champions)})</option>
          {champions.map(c => <option key={c.team_id} value={String(c.team_id)}>#{c.seed} {c.name} ({smartNum(c.count)})</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="number" min={0} max={32} placeholder="Min upsets" value={minUpsets}
            onChange={e => applyFilterChange({ minUp: e.target.value })}
            style={{ ...inputStyle, width: 110 }} suppressHydrationWarning />
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>–</span>
          <input type="number" min={0} max={32} placeholder="Max upsets" value={maxUpsets}
            onChange={e => applyFilterChange({ maxUp: e.target.value })}
            style={{ ...inputStyle, width: 110 }} suppressHydrationWarning />
        </div>
        <button onClick={() => setShowAdvanced(true)} suppressHydrationWarning style={{
          ...btnStyle, color: pickFilters.length > 0 ? "var(--accent)" : "var(--text-secondary)",
          borderColor: pickFilters.length > 0 ? "var(--accent-glow)" : "var(--border)",
        }}>Advanced{pickFilters.length > 0 ? ` (${pickFilters.length})` : ""}</button>
        {(champFilter || minUpsets || maxUpsets || pickFilters.length > 0) && (
          <button suppressHydrationWarning onClick={clearAllFilters}
            style={{ ...btnStyle, color: "var(--wrong)", borderColor: "var(--wrong-dim)" }}>Clear filters</button>
        )}
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{smartNum(total)} brackets</span>
      </div>

      {showAdvanced && <AdvancedFilter pickFilters={pickFilters}
        onApply={(f) => { applyFilterChange({ picks: f }); setShowAdvanced(false); }}
        onClose={() => setShowAdvanced(false)} />}

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {COLUMNS.map(col => <Th key={col.key} sortable={col.sortable} active={sort === col.key} asc={order === "asc"} onClick={col.sortable ? () => toggleSort(col.key) : undefined}>{col.label}</Th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`skel-${i}`} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    {Array.from({ length: COLUMNS.length }).map((_, j) => <td key={j} style={{ padding: "14px 16px" }}><div style={{ height: 14, borderRadius: 3, background: "var(--bg-elevated)", width: j === 1 ? 80 : 50 }} /></td>)}
                  </tr>
                ))
              ) : brackets.length === 0 ? (
                <tr><td colSpan={COLUMNS.length} style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>No brackets match these filters.</td></tr>
              ) : (
                brackets.map((b, idx) => (
                  <tr key={`${b.id}-${idx}`}
                    onClick={() => router.push(`/brackets/${b.bracket_hash}`)}
                    style={{ borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-elevated)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")} className="fade-in">
                    <td style={tdStyle}><span style={{ ...numStyle, color: "var(--text-muted)" }}>{b.rank != null ? smartNum(b.rank) : "—"}</span></td>
                    <td style={tdStyle}><span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--accent)", letterSpacing: "0.05em" }}>{b.bracket_hash}</span></td>
                    <td style={tdStyle}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="seed-badge">{b.champion_seed ?? "?"}</span><span style={{ fontSize: 13, color: "var(--text-primary)" }}>{b.champion_name ?? "—"}</span></div></td>
                    <td style={tdStyle}><span style={{ ...numStyle, fontSize: 14, fontWeight: 600 }}>{b.total_points}</span></td>
                    <td style={tdStyle}><span style={numStyle}>{b.max_points != null ? b.max_points : "—"}</span></td>
                    <td style={tdStyle}><span style={numStyle}>{b.games_decided > 0 ? `${b.correct_picks}/${b.games_decided}` : "—"}</span></td>
                    <td style={tdStyle}><span style={numStyle}>{b.perfect_streak != null ? b.perfect_streak : "—"}</span></td>
                    <td style={tdStyle}><span style={numStyle}>{b.upset_count}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={btnStyle}>← Prev</button>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>Page {page} of {smartNum(totalPages)}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={btnStyle}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LeaderboardClient(props: Props) {
  return <Suspense fallback={<div className="card animate-pulse" style={{ height: 400 }} />}><LeaderboardInner {...props} /></Suspense>;
}

function Th({ children, sortable, active, asc, onClick }: { children: React.ReactNode; sortable?: boolean; active?: boolean; asc?: boolean; onClick?: () => void; }) {
  return <th onClick={onClick} style={{ padding: "12px 16px", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: active ? "var(--accent)" : "var(--text-muted)", cursor: sortable ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>{children}{sortable && active && <span style={{ marginLeft: 4 }}>{asc ? "↑" : "↓"}</span>}</th>;
}

const tdStyle: React.CSSProperties = { padding: "13px 16px", verticalAlign: "middle" };
const selectStyle: React.CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontFamily: "var(--font-body)", fontSize: 13, padding: "6px 10px", outline: "none", cursor: "pointer" };
const inputStyle: React.CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "6px 10px", outline: "none" };
const btnStyle: React.CSSProperties = { background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "5px 12px", cursor: "pointer", letterSpacing: "0.03em" };
