// components/BackLink.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Props {
  fallback: string;
  label: string;
}

export default function BackLink({ fallback, label }: Props) {
  const [href, setHref] = useState(fallback);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("leaderboard_return_url");
      if (saved) setHref(saved);
    } catch {}
  }, []);

  return (
    <Link
      href={href}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--text-muted)",
        textDecoration: "none",
        letterSpacing: "0.06em",
      }}
    >
      ← {label}
    </Link>
  );
}
