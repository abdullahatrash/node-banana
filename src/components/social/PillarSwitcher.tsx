"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

const PILLARS = [
  { id: "studio", label: "AI Studio", icon: "🎨", href: "/studio" },
  { id: "social", label: "Social Hub", icon: "📱", href: "/social" },
  { id: "analytics", label: "Analytics", icon: "📊", href: "/analytics" },
] as const;

interface PillarSwitcherProps {
  currentPillar?: string;
}

export function PillarSwitcher({
  currentPillar = "social",
}: PillarSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = PILLARS.find((p) => p.id === currentPillar) ?? PILLARS[1];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-md bg-neutral-800 border border-neutral-700 px-2.5 py-1 text-sm font-medium text-neutral-200 hover:bg-neutral-700 transition-colors"
      >
        <span>{current.icon}</span>
        <span>{current.label}</span>
        <span className="text-xs text-neutral-500 ml-0.5">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-52 rounded-lg bg-neutral-800 border border-neutral-700 shadow-lg z-50 py-1">
          {PILLARS.map((pillar) => (
            <Link
              key={pillar.id}
              href={pillar.href}
              onClick={() => setIsOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                pillar.id === currentPillar
                  ? "bg-neutral-700 text-green-400"
                  : "text-neutral-300 hover:bg-neutral-700/50"
              }`}
            >
              <span>{pillar.icon}</span>
              <span>{pillar.label}</span>
              {pillar.id === currentPillar && (
                <span className="ml-auto text-xs text-neutral-500">
                  current
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
