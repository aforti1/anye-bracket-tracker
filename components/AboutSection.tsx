// components/AboutSection.tsx
"use client";
import { useState } from "react";

export default function AboutSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        maxWidth: 680,
        width: "100%",
        borderTop: "1px solid var(--border)",
        paddingTop: 32,
      }}
    >
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "0 auto",
          padding: "8px 16px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
          }}
        >
          About This Project
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-muted)",
            transition: "transform 0.2s",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          ▾
        </span>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div
          style={{
            marginTop: 20,
            animation: "aboutFadeIn 0.3s ease-out",
          }}
        >
          {/* Quick stats */}
          <div
            style={{
              display: "flex",
              gap: 0,
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--bg-card)",
              marginBottom: 28,
            }}
          >
            {[
              { value: "3", label: "ML Models" },
              { value: "22", label: "Years Training Data" },
              { value: "63", label: "Games per Bracket" },
              { value: "15", label: "Backtest Years" },
            ].map((stat, i) => (
              <div
                key={stat.label}
                style={{
                  flex: "1 1 0",
                  padding: "14px 12px",
                  borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    lineHeight: 1.1,
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    marginTop: 4,
                  }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Content sections */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Section title="The Approach">
              Instead of optimizing for one best guess, this system generates a portfolio
              of brackets that collectively cover the space of plausible tournament outcomes.
              The insight is that bracket prediction under single-elimination variance is a
              coverage problem — no model can reliably predict 63 consecutive outcomes, but
              a well-constructed collection of brackets can cover significantly more of the
              outcome space than any single entry.
            </Section>

            <Section title="Generation Engine">
              Each bracket is produced through forward sampling — a full simulation of all
              63 tournament games. For each matchup, the system computes a win probability
              from the actual performance profiles of both teams, then samples a winner
              proportionally. Each subsequent game is conditioned on the outcomes of all
              prior games in that bracket — probabilities shift dynamically as upsets propagate.
              Every bracket is internally self-consistent.
            </Section>

            <Section title="The Ensemble">
              Win probabilities come from an ensemble of three models — XGBoost, Logistic
              Regression, and LightGBM — trained on historical tournament data. The models
              ingest adjusted efficiency metrics (offensive and defensive efficiency, tempo,
              the Four Factors, and strength of schedule). Seed numbers are deliberately
              excluded — outcomes are predicted from how teams actually play, not where the
              committee placed them.
            </Section>

            <Section title="Validation">
              The entire pipeline was backtested on every NCAA tournament from 2010 to 2025
              (excluding 2020), using strict temporal holdout — models are trained only on
              seasons prior to the test year. No future information leaks into any prediction.
            </Section>
          </div>

          {/* Footer */}
          <div
            style={{
              height: 1,
              background: "var(--border)",
              margin: "28px 0 16px",
            }}
          />
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-muted)",
              letterSpacing: "0.04em",
              lineHeight: 1.8,
              textAlign: "center",
            }}
          >
            Built with Python, XGBoost, LightGBM, and scikit-learn.
            <br />
            Data sourced from KenPom and historical NCAA tournament records.
            <br />
            <span style={{ color: "var(--text-secondary)" }}>
              © 2026 Anye-Nkwenti Forti
            </span>
          </p>
        </div>
      )}

      <style jsx global>{`
        @keyframes aboutFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "0.03em",
          color: "var(--accent)",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-secondary)",
        }}
      >
        {children}
      </p>
    </div>
  );
}
