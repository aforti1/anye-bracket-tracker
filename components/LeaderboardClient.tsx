// components/LeaderboardClient.tsx
"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { BracketRow, TournamentSummary } from "@/lib/types";
import AdvancedFilter from "@/components/AdvancedFilter";
import AboutModal from "@/components/AboutModal";

interface Champion { team_id: number; name: string; seed: number; count: number; }
interface Props { summary: TournamentSummary; champions: Champion[]; }

function smartNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    if (k >= 100) return `${Math.round(k)}K`;
    if (k >= 10) return `${parseFloat((Math.round(k * 10) / 10).toFixed(1))}K`;
    return `${parseFloat((Math.round(k * 100) / 100).toFixed(2))}K`;
  }
  const m = n / 1_000_000;
  if (m >= 100) return `${Math.round(m)}M`;
  if (m >= 10) return `${parseFloat((Math.round(m * 10) / 10).toFixed(1))}M`;
  return `${parseFloat((Math.round(m * 100) / 100).toFixed(2))}M`;
}

const COLUMNS = [
  { key: "rank",            label: "Rank",            sortable: true },
  { key: "bracket_hash",    label: "Bracket ID",      sortable: true },
  { key: "champion_name",   label: "Champion",        sortable: true },
  { key: "total_points",    label: "Points",          sortable: true },
  { key: "max_points",      label: "Max Points",      sortable: true },
  { key: "correct_picks",   label: "Correct",         sortable: true },
  { key: "perfect_streak",  label: "Perfect Streak",  sortable: true },
  { key: "upset_count",     label: "Upsets",           sortable: true },
];

const PER_PAGE = 50;
const CACHE_KEY = "leaderboard_cache";

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
  const [filterLoading, setFilterLoading] = useState(false); // heavy filter scan in progress
  const [totalPages, setTotalPages]   = useState(1);
  const [total, setTotal]             = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [minUpsetsInput, setMinUpsetsInput] = useState(minUpsets);
  const [maxUpsetsInput, setMaxUpsetsInput] = useState(maxUpsets);

  // Cached filtered IDs — the expensive scan result, reused for pagination
  const [filteredIds, setFilteredIds] = useState<number[] | null>(null);
  const filterKeyRef = useRef("");
  const conditionsKeyRef = useRef("");

  const isInitialMount = useRef(true);
  const fetchController = useRef<AbortController | null>(null);

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

  // Build a key that uniquely identifies the current filter + sort combination
  const buildFilterKey = useCallback(() => {
    return JSON.stringify({
      champ: champFilter, minUp: minUpsets, maxUp: maxUpsets,
      picks: pickFilters, sort, order,
    });
  }, [champFilter, minUpsets, maxUpsets, pickFilters, sort, order]);

  // Conditions-only key (no sort) — used to detect sort-only changes
  const buildConditionsKey = useCallback(() => {
    return JSON.stringify({
      champ: champFilter, minUp: minUpsets, maxUp: maxUpsets,
      picks: pickFilters,
    });
  }, [champFilter, minUpsets, maxUpsets, pickFilters]);

  const hasActiveFilters = !!(champFilter || minUpsets || maxUpsets || pickFilters.length > 0);

  // ── FETCH: filtered path (scan IDs once, then paginate by ID) ──
  const fetchFilteredPage = useCallback(async (ids: number[], pg: number) => {
    const start = (pg - 1) * PER_PAGE;
    const pageIds = ids.slice(start, start + PER_PAGE);
    if (pageIds.length === 0) {
      setBrackets([]); return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/brackets/by-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pageIds }),
      });
      const data = await res.json();
      let results = data.brackets ?? [];
      // Sort by computed columns client-side (these can't be sorted in SQL)
      if (sort === "max_points" || sort === "perfect_streak") {
        results.sort((a: any, b: any) => {
          const va = a[sort] ?? 0;
          const vb = b[sort] ?? 0;
          return order === "desc" ? vb - va : va - vb;
        });
      }
      setBrackets(results);
      // Cache for back-nav
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          filterKey: buildFilterKey(), ids, page: pg,
          brackets: results, total: ids.length, ts: Date.now(),
        }));
      } catch {}
    } catch (err: any) {
      if (err.name !== "AbortError") console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [buildFilterKey, sort, order]);

  // ── MAIN EFFECT: runs on any state change ──
  useEffect(() => {
    const currentFilterKey = buildFilterKey();
    const currentConditionsKey = buildConditionsKey();

    // ── NO FILTERS: use normal indexed Supabase query ──
    if (!hasActiveFilters) {
      setFilteredIds(null);
      filterKeyRef.current = "";
      conditionsKeyRef.current = "";

      // Check sessionStorage for back-nav
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const c = JSON.parse(cached);
          if (!c.filterKey && c.page === page && c.sort === sort && c.order === order && Date.now() - c.ts < 60000) {
            setBrackets(c.brackets ?? []);
            setTotalPages(c.totalPages ?? 1);
            setTotal(c.total ?? 0);
            setLoading(false);
            return;
          }
        }
      } catch {}

      if (fetchController.current) fetchController.current.abort();
      const controller = new AbortController();
      fetchController.current = controller;

      setLoading(true);
      const params = new URLSearchParams({
        page: String(page), per_page: String(PER_PAGE), sort, order,
      });
      fetch(`/api/brackets?${params}`, { signal: controller.signal })
        .then(r => r.json())
        .then(data => {
          if (data.error) {
            console.error("Brackets API error:", data.error);
            setBrackets([]); setTotalPages(1); setTotal(0);
          } else {
            setBrackets(data.brackets ?? []);
            setTotalPages(data.total_pages ?? 1);
            setTotal(data.total ?? 0);
            try {
              sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                page, sort, order, brackets: data.brackets,
                totalPages: data.total_pages, total: data.total, ts: Date.now(),
              }));
            } catch {}
          }
          setLoading(false);
        })
        .catch(err => { if (err.name !== "AbortError") setLoading(false); });
      return;
    }

    // ── FILTERS ACTIVE ──

    // If we already have cached IDs for this exact filter+sort combo, just paginate
    if (filteredIds && filterKeyRef.current === currentFilterKey) {
      setTotal(filteredIds.length);
      setTotalPages(Math.ceil(filteredIds.length / PER_PAGE));
      fetchFilteredPage(filteredIds, page);
      return;
    }

    // Check sessionStorage for cached IDs from back-nav
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const c = JSON.parse(cached);
        if (c.filterKey === currentFilterKey && c.ids && Date.now() - c.ts < 120000) {
          const ids = c.ids as number[];
          setFilteredIds(ids);
          filterKeyRef.current = currentFilterKey;
          conditionsKeyRef.current = currentConditionsKey;
          setTotal(ids.length);
          setTotalPages(Math.ceil(ids.length / PER_PAGE));
          // If same page, use cached brackets directly
          if (c.page === page && c.brackets) {
            setBrackets(c.brackets);
            setLoading(false);
            return;
          }
          fetchFilteredPage(ids, page);
          return;
        }
      }
    } catch {}

    // Detect if only sort changed (same filter conditions, different sort)
    const isSortChangeOnly = conditionsKeyRef.current === currentConditionsKey && conditionsKeyRef.current !== "";

    // New filter combo — fetch sorted IDs
    // Only show heavy overlay for actual filter changes, not just sort changes
    if (!isSortChangeOnly) setFilterLoading(true);
    setLoading(true);

    const params = new URLSearchParams();
    if (champFilter && pickFilters.length === 0) params.set("champion_id", champFilter);
    if (minUpsets) params.set("min_upsets", minUpsets);
    if (maxUpsets) params.set("max_upsets", maxUpsets);
    if (pickFilters.length > 0) params.set("pick_filters", JSON.stringify(pickFilters));
    params.set("sort", sort);
    params.set("order", order);

    fetch(`/api/brackets/filter-ids?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          console.error("Filter IDs error:", data.error);
          setBrackets([]); setTotal(0); setTotalPages(1);
          setLoading(false); setFilterLoading(false);
          return;
        }
        const ids = data.ids as number[];
        setFilteredIds(ids);
        filterKeyRef.current = currentFilterKey;
        conditionsKeyRef.current = currentConditionsKey;
        setTotal(ids.length);
        setTotalPages(Math.ceil(ids.length / PER_PAGE));
        setFilterLoading(false);

        if (ids.length === 0) {
          setBrackets([]); setLoading(false);
          return;
        }
        fetchFilteredPage(ids, page);
      })
      .catch(err => {
        console.error("Filter error:", err);
        setLoading(false); setFilterLoading(false);
      });
  }, [page, sort, order, champFilter, minUpsets, maxUpsets, pickFilters, hasActiveFilters, buildFilterKey, buildConditionsKey, filteredIds, fetchFilteredPage]);

  // Helper: apply a filter change + reset sort to rank asc + page 1
  const applyFilterChange = (updates: {
    champ?: string; minUp?: string; maxUp?: string; picks?: typeof pickFilters;
  }) => {
    // Clear cached IDs so the next effect does a fresh scan
    setFilteredIds(null);
    filterKeyRef.current = "";
    conditionsKeyRef.current = "";

    if (updates.champ !== undefined) setChampFilter(updates.champ);
    if (updates.minUp !== undefined) setMinUpsets(updates.minUp);
    if (updates.maxUp !== undefined) setMaxUpsets(updates.maxUp);
    if (updates.picks !== undefined) setPickFilters(updates.picks);

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
    setFilteredIds(null);
    filterKeyRef.current = "";
    conditionsKeyRef.current = "";
    setChampFilter(""); setMinUpsets(""); setMaxUpsets(""); setPickFilters([]);
    setMinUpsetsInput(""); setMaxUpsetsInput("");
    setSort("total_points"); setOrder("desc"); setPage(1);
    try { sessionStorage.removeItem(CACHE_KEY); } catch {}
  };

  const toggleSort = (key: string) => {
    // For filtered results, clear cached IDs to force re-fetch with new sort order.
    // NOTE: conditionsKeyRef is intentionally NOT cleared — this lets the effect
    // detect it's a sort-only change and skip the heavy "Filtering..." overlay.
    if (hasActiveFilters) {
      setFilteredIds(null);
      filterKeyRef.current = "";
    }
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
          <input type="number" min={0} max={32} placeholder="Min upsets" value={minUpsetsInput}
            onChange={e => setMinUpsetsInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") applyFilterChange({ minUp: minUpsetsInput }); }}
            onBlur={() => { if (minUpsetsInput !== minUpsets) applyFilterChange({ minUp: minUpsetsInput }); }}
            style={{ ...inputStyle, width: 110 }} suppressHydrationWarning />
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>–</span>
          <input type="number" min={0} max={32} placeholder="Max upsets" value={maxUpsetsInput}
            onChange={e => setMaxUpsetsInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") applyFilterChange({ maxUp: maxUpsetsInput }); }}
            onBlur={() => { if (maxUpsetsInput !== maxUpsets) applyFilterChange({ maxUp: maxUpsetsInput }); }}
            style={{ ...inputStyle, width: 110 }} suppressHydrationWarning />
        </div>
        <button onClick={() => setShowAdvanced(true)} suppressHydrationWarning style={{
          ...btnStyle, color: pickFilters.length > 0 ? "var(--accent)" : "var(--text-secondary)",
          borderColor: pickFilters.length > 0 ? "var(--accent-glow)" : "var(--border)",
        }}>Advanced{pickFilters.length > 0 ? ` (${pickFilters.length})` : ""}</button>
        <button onClick={() => setShowAbout(true)} suppressHydrationWarning style={{
          ...btnStyle,
          background: "linear-gradient(135deg, #f5a623, #e8941a)",
          border: "1px solid #f5a62366",
          color: "#0a0a0b",
          fontWeight: 600,
          letterSpacing: "0.04em",
          boxShadow: "0 0 12px rgba(245, 166, 35, 0.15)",
        }}>About</button>
        {(champFilter || minUpsets || maxUpsets || pickFilters.length > 0) && (
          <button suppressHydrationWarning onClick={clearAllFilters}
            style={{ ...btnStyle, color: "var(--wrong)", borderColor: "var(--wrong-dim)" }}>Clear filters</button>
        )}
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{smartNum(total)} brackets</span>
      </div>

      {showAdvanced && <AdvancedFilter pickFilters={pickFilters}
        onApply={(f) => { applyFilterChange({ picks: f }); setShowAdvanced(false); }}
        onClose={() => setShowAdvanced(false)} />}

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      {/* Full-viewport loading overlay for expensive filter scans */}
      {filterLoading && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 50,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "rgba(10, 10, 11, 0.88)", backdropFilter: "blur(4px)",
        }}>
          <div style={{
            width: 44, height: 44, border: "3px solid var(--border)",
            borderTopColor: "var(--accent)", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <span style={{
            marginTop: 20, fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 500,
            color: "#ffffff", letterSpacing: "0.04em",
          }}>
            Filtering {smartNum(parseInt(String(summary.total_brackets)))} brackets...
          </span>
          <span style={{
            marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 13,
            color: "var(--text-secondary)",
          }}>
            This may take a few seconds
          </span>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden", minHeight: "calc(100vh - 280px)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {COLUMNS.map(col => <Th key={col.key} sortable={col.sortable} active={sort === col.key} asc={order === "asc"} onClick={col.sortable ? () => toggleSort(col.key) : undefined}>{col.label}</Th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 20 }).map((_, i) => (
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

      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function LeaderboardClient(props: Props) {
  return <Suspense fallback={<div className="card animate-pulse" style={{ minHeight: "calc(100vh - 280px)" }} />}><LeaderboardInner {...props} /></Suspense>;
}

function Th({ children, sortable, active, asc, onClick }: { children: React.ReactNode; sortable?: boolean; active?: boolean; asc?: boolean; onClick?: () => void; }) {
  return <th onClick={onClick} style={{ padding: "12px 16px", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: active ? "var(--accent)" : "var(--text-muted)", cursor: sortable ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>{children}{sortable && active && <span style={{ marginLeft: 4 }}>{asc ? "↑" : "↓"}</span>}</th>;
}

const tdStyle: React.CSSProperties = { padding: "13px 16px", verticalAlign: "middle" };
const selectStyle: React.CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontFamily: "var(--font-body)", fontSize: 13, padding: "6px 10px", outline: "none", cursor: "pointer" };
const inputStyle: React.CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "6px 10px", outline: "none" };
const btnStyle: React.CSSProperties = { background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "5px 12px", cursor: "pointer", letterSpacing: "0.03em" };
