// components/LeaderboardClient.tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { BracketRow, TournamentSummary } from "@/lib/types";
import { formatAccuracy } from "@/lib/scoring";

interface Champion { team_id: number; name: string; seed: number; count: number; }
interface Props { summary: TournamentSummary; champions: Champion[]; }

const SORTS = [
  { key: "bracket_hash",  label: "Bracket ID" },
  { key: "champion_name", label: "Champion" },
  { key: "total_points",  label: "Points" },
  { key: "correct_picks", label: "Correct" },
  { key: "accuracy",      label: "Accuracy" },
  { key: "upset_count",   label: "Upsets" },
  { key: "log_prob",      label: "Probability" },
];

export default function LeaderboardClient({ summary, champions }: Props) {
  const router = useRouter();
  const [brackets, setBrackets]       = useState<BracketRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [page, setPage]               = useState(1);
  const [totalPages, setTotalPages]   = useState(1);
  const [total, setTotal]             = useState(0);
  const [sort, setSort]               = useState("total_points");
  const [order, setOrder]             = useState<"asc" | "desc">("desc");
  const [champFilter, setChampFilter] = useState<string>("");
  const [minUpsets, setMinUpsets]     = useState("");
  const [maxUpsets, setMaxUpsets]     = useState("");

  const fetchBrackets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      per_page: "50",
      sort,
      order,
      ...(champFilter && { champion_id: champFilter }),
      ...(minUpsets   && { min_upsets: minUpsets }),
      ...(maxUpsets   && { max_upsets: maxUpsets }),
    });
    const res  = await fetch(`/api/brackets?${params}`);
    const data = await res.json();
    setBrackets(data.brackets ?? []);
    setTotalPages(data.total_pages ?? 1);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [page, sort, order, champFilter, minUpsets, maxUpsets]);

  useEffect(() => { fetchBrackets(); }, [fetchBrackets]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [sort, order, champFilter, minUpsets, maxUpsets]);

  const toggleSort = (key: string) => {
    if (sort === key) {
      setOrder(o => o === "desc" ? "asc" : "desc");
    } else {
      setSort(key);
      setOrder("desc");
    }
  };

  return (
    <div>
      {/* Filters */}
      <div style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        marginBottom: 16,
        flexWrap: "wrap",
      }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em" }}>
          FILTER:
        </span>

        {/* Champion filter */}
        <select
          value={champFilter}
          onChange={e => setChampFilter(e.target.value)}
          style={selectStyle}
          suppressHydrationWarning
        >
          <option value="">All Champions</option>
          {champions.slice(0, 30).map(c => (
            <option key={c.team_id} value={String(c.team_id)}>
              #{c.seed} {c.name} ({c.count.toLocaleString()})
            </option>
          ))}
        </select>

        {/* Upsets filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number" min={0} max={32} placeholder="Min upsets"
            value={minUpsets} onChange={e => setMinUpsets(e.target.value)}
            style={{ ...inputStyle, width: 110 }}
            suppressHydrationWarning
          />
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>–</span>
          <input
            type="number" min={0} max={32} placeholder="Max upsets"
            value={maxUpsets} onChange={e => setMaxUpsets(e.target.value)}
            style={{ ...inputStyle, width: 110 }}
            suppressHydrationWarning
          />
        </div>

        {(champFilter || minUpsets || maxUpsets) && (
          <button onClick={() => { setChampFilter(""); setMinUpsets(""); setMaxUpsets(""); }}
            style={{ ...btnStyle, color: "var(--wrong)", borderColor: "var(--wrong-dim)" }}>
            Clear filters
          </button>
        )}

        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
          {total.toLocaleString()} brackets
        </span>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <Th>Rank</Th>
                {SORTS.map(s => (
                  <Th key={s.key} sortable active={sort === s.key} asc={order === "asc"}
                    onClick={() => toggleSort(s.key)}>
                    {s.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} style={{ padding: "14px 16px" }}>
                        <div style={{ height: 14, borderRadius: 3, background: "var(--bg-elevated)", width: j === 1 ? 80 : 50 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : brackets.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    No brackets loaded yet. Data will appear after the portfolio is seeded.
                  </td>
                </tr>
              ) : (
                brackets.map((b, i) => (
                  <tr
                    key={b.id}
                    onClick={() => router.push(`/brackets/${b.bracket_hash}`)}
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-elevated)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    className="fade-in"
                  >
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)" }}>
                        {b.rank != null ? b.rank.toLocaleString() : ((page - 1) * 50 + i + 1).toLocaleString()}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--accent)",
                        letterSpacing: "0.05em",
                      }}>
                        {b.bracket_hash}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="seed-badge">
                          {b.champion_seed ?? "?"}
                        </span>
                        <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
                          {b.champion_name ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                        {b.total_points.toLocaleString()}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
                        {formatAccuracy(b.correct_picks, b.games_decided)}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
                        {b.games_decided > 0 ? `${Math.round(b.accuracy * 100)}%` : "—"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                        {b.upset_count}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                        {b.log_prob != null ? b.log_prob.toFixed(1) : "—"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={btnStyle}>
              ← Prev
            </button>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
              Page {page} of {totalPages.toLocaleString()}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={btnStyle}>
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Sub-components ----

function Th({ children, sortable, active, asc, onClick }: {
  children: React.ReactNode;
  sortable?: boolean;
  active?: boolean;
  asc?: boolean;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      style={{
        padding: "12px 16px",
        textAlign: "left",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: active ? "var(--accent)" : "var(--text-muted)",
        cursor: sortable ? "pointer" : "default",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {active && <span style={{ marginLeft: 4 }}>{asc ? "↑" : "↓"}</span>}
    </th>
  );
}

// Styles
const tdStyle: React.CSSProperties = {
  padding: "13px 16px",
  verticalAlign: "middle",
};

const selectStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  padding: "6px 10px",
  outline: "none",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "6px 10px",
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "5px 12px",
  cursor: "pointer",
  letterSpacing: "0.03em",
};
