// components/AboutModal.tsx
"use client";

import { useEffect, useRef } from "react";

export default function AboutModal({ onClose }: { onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose();
  };

  const heading: React.CSSProperties = {
    fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700,
    color: "var(--accent)", letterSpacing: "0.02em", marginTop: 28, marginBottom: 10,
  };
  const paragraph: React.CSSProperties = {
    fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.7,
    color: "var(--text-primary)", marginBottom: 12,
  };
  const muted: React.CSSProperties = {
    ...paragraph, color: "var(--text-secondary)", fontSize: 13,
  };
  const highlight: React.CSSProperties = {
    color: "var(--accent)", fontWeight: 600,
  };
  const statCard: React.CSSProperties = {
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "16px 20px", textAlign: "center" as const, flex: 1,
    minWidth: 120,
  };
  const statNum: React.CSSProperties = {
    fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800,
    color: "var(--text-primary)", lineHeight: 1,
  };
  const statLabel: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)",
    letterSpacing: "0.08em", textTransform: "uppercase" as const, marginTop: 6,
  };
  const stepCard: (color: string) => React.CSSProperties = (color) => ({
    background: "var(--bg-elevated)", border: `1px solid ${color}22`,
    borderLeft: `3px solid ${color}`, borderRadius: 6,
    padding: "12px 16px", marginBottom: 10,
  });
  const stepTitle: (color: string) => React.CSSProperties = (color) => ({
    fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700,
    color, marginBottom: 4,
  });
  const stepDesc: React.CSSProperties = {
    fontFamily: "var(--font-body)", fontSize: 13, lineHeight: 1.6,
    color: "var(--text-secondary)",
  };

  return (
    <div onClick={handleBackdrop} style={{
      position: "fixed", inset: 0, zIndex: 999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0, 0, 0, 0.75)", backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      animation: "aboutFadeIn 0.25s ease-out",
    }}>
      <div ref={modalRef} style={{
        width: "min(640px, 92vw)", maxHeight: "85vh", overflowY: "auto",
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "32px 36px",
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(245, 166, 35, 0.08)",
        animation: "aboutSlideUp 0.3s ease-out",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800,
              color: "var(--text-primary)", letterSpacing: "-0.01em", lineHeight: 1.2,
            }}>
              About This Portfolio
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)",
              letterSpacing: "0.06em", marginTop: 6,
            }}>
              DESIGNED BY ANYE-NKWENTI FORTI
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: "var(--text-muted)",
            fontSize: 22, cursor: "pointer", padding: "4px 8px", lineHeight: 1,
            borderRadius: 4, transition: "color 0.15s",
          }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}>
            ✕
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--border)", margin: "16px 0 20px" }} />

        {/* Intro */}
        <p style={paragraph}>
          Most bracket predictions start and end with a single entry — one set of picks, one
          shot at getting it right. The problem is that March Madness is a single-elimination
          tournament with 63 games, and even the most sophisticated prediction model can't
          account for every possible outcome in one bracket. This project reframes the problem
          entirely: instead of optimizing for one best guess, it generates
          a <span style={highlight}>portfolio of one million brackets</span> that collectively
          cover the space of plausible tournament outcomes.
        </p>
        <p style={muted}>
          Every bracket in this portfolio is generated by the same statistical engine — no
          manual picks, no heuristics, no seed-based rules.
        </p>

        {/* Quick stats */}
        <div style={{ display: "flex", gap: 12, margin: "20px 0 24px", flexWrap: "wrap" }}>
          <div style={statCard}>
            <div style={statNum}>1M</div>
            <div style={statLabel}>Brackets Generated</div>
          </div>
          <div style={statCard}>
            <div style={statNum}>3</div>
            <div style={statLabel}>ML Models</div>
          </div>
          <div style={statCard}>
            <div style={statNum}>22</div>
            <div style={statLabel}>Years of Training Data</div>
          </div>
          <div style={statCard}>
            <div style={statNum}>63M</div>
            <div style={statLabel}>Probabilities Computed</div>
          </div>
        </div>

        {/* Section: The Core Idea */}
        <div style={heading}>The Portfolio Approach</div>
        <p style={paragraph}>
          The core insight is that bracket prediction under single-elimination variance is
          better treated as a coverage problem than an optimization problem. No model —
          regardless of accuracy — can reliably predict 63 consecutive outcomes. But a
          large, well-constructed collection of brackets, where each one represents a
          different statistically plausible version of the tournament, can cover
          significantly more of the outcome space than any single entry.
        </p>
        <p style={paragraph}>
          The analogy is portfolio theory in finance: diversify across correlated but
          distinct positions, balance expected value against variance, and maximize the
          probability that at least one position performs exceptionally well.
        </p>

        {/* Section: How It Works */}
        <div style={heading}>Generation Engine</div>
        <p style={paragraph}>
          Each bracket is produced through <span style={highlight}>forward sampling</span> — a
          full conditional simulation of all 63 tournament games. The process works as follows:
        </p>

        <div style={stepCard("var(--correct)")}>
          <div style={stepTitle("var(--correct)")}>1 — Matchup Probability</div>
          <div style={stepDesc}>
            For each game, the system identifies the two teams that would be playing based on
            who advanced in prior rounds of this specific bracket. It then queries the ensemble
            for a win probability derived from the actual season-long performance profiles of
            those two teams.
          </div>
        </div>

        <div style={stepCard("var(--east)")}>
          <div style={stepTitle("var(--east)")}>2 — Probabilistic Sampling</div>
          <div style={stepDesc}>
            Rather than deterministically picking the favorite, the system samples a winner
            proportional to the predicted probability. A 72% favorite wins in roughly 72% of
            brackets — and the upset occurs in the other 28%. This is what generates meaningful
            diversity across the portfolio without introducing arbitrary randomness.
          </div>
        </div>

        <div style={stepCard("var(--west)")}>
          <div style={stepTitle("var(--west)")}>3 — Conditional Propagation</div>
          <div style={stepDesc}>
            Each game's probability is conditioned on the outcomes of all prior games in that
            bracket. This means probabilities shift dynamically — if a lower-seeded team
            upsets its way into the Sweet 16, the model computes its actual probability against
            whatever opponent it now faces, not a pre-tournament static estimate. Every bracket
            is internally self-consistent.
          </div>
        </div>

        <div style={stepCard("var(--midwest)")}>
          <div style={stepTitle("var(--midwest)")}>4 — Scale</div>
          <div style={stepDesc}>
            This 63-game walk is executed one million times. Each run produces a unique bracket —
            a full tournament simulation with its own upset patterns, Final Four, and champion.
            Across the portfolio, the distribution of outcomes naturally reflects the model's
            uncertainty at every node of the bracket.
          </div>
        </div>

        {/* Section: The Models */}
        <div style={heading}>The Ensemble</div>
        <p style={paragraph}>
          The win probabilities are generated by an <span style={{ color: "var(--correct)", fontWeight: 600 }}>ensemble
          of three models</span> — XGBoost, Logistic Regression, and LightGBM — trained on
          22 seasons of college basketball data (2003–2025, excluding 2020). The models ingest
          KenPom's adjusted efficiency metrics: offensive and defensive efficiency, tempo,
          the Four Factors (effective field goal percentage, turnover rate, offensive rebound
          rate, and free throw rate), and strength of schedule.
        </p>
        <p style={paragraph}>
          The ensemble averages across model families to reduce individual model bias. Each
          model brings a different inductive bias — XGBoost captures non-linear interactions
          between features, Logistic Regression provides well-calibrated baseline probabilities,
          and LightGBM handles residual patterns the other two miss.
        </p>
        <p style={muted}>
          Seed numbers are deliberately excluded as features. The models predict outcomes based
          on how teams perform, not where the selection committee placed them.
        </p>

        {/* Section: Diversity */}
        <div style={heading}>Emergent Diversity</div>
        <p style={paragraph}>
          The portfolio's diversity isn't engineered through bracket tiers or manual upset
          injection — it emerges naturally from the probabilistic sampling process. When
          you sample one million times from a conditional probability tree with 63 nodes,
          the resulting brackets span a wide range of outcomes: chalk-heavy brackets, deep
          Cinderella runs, split Final Fours, and everything in between.
        </p>
        <p style={paragraph}>
          The distribution of upset counts, champion picks, and regional outcomes across the
          portfolio directly reflects the model's calibrated uncertainty — not arbitrary
          diversification.
        </p>

        {/* Section: Validation */}
        <div style={heading}>Validation</div>
        <p style={paragraph}>
          The entire pipeline was backtested on every NCAA tournament from 2010 to 2025
          (excluding 2020), totaling 15 holdout years. Each backtest uses a strict temporal
          holdout — models are trained only on seasons prior to the test year, with a minimum
          of seven years of training data required. No future information leaks into any
          prediction. The same generation process that produced this portfolio was validated
          against real tournament outcomes across all 15 years before being deployed on 2026.
        </p>

        {/* Footer */}
        <div style={{ height: 1, background: "var(--border)", margin: "24px 0 16px" }} />
        <p style={{
          fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)",
          letterSpacing: "0.04em", lineHeight: 1.8, textAlign: "center",
        }}>
          Built with Python, XGBoost, LightGBM, and scikit-learn.
          <br />
          Data sourced from KenPom and historical NCAA tournament records.
          <br />
          <span style={{ color: "var(--text-secondary)" }}>© 2026 Anye-Nkwenti Forti</span>
        </p>
      </div>

      <style jsx global>{`
        @keyframes aboutFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes aboutSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
