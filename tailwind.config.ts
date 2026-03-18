import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body:    ["var(--font-body)",    "sans-serif"],
        mono:    ["var(--font-mono)",    "monospace"],
      },
      colors: {
        bg:          "var(--bg)",
        card:        "var(--bg-card)",
        elevated:    "var(--bg-elevated)",
        border:      "var(--border)",
        accent:      "var(--accent)",
        correct:     "var(--correct)",
        wrong:       "var(--wrong)",
        "text-primary":   "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted":     "var(--text-muted)",
      },
    },
  },
  plugins: [],
};

export default config;
