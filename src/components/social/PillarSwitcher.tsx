"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChannelsIcon, ChevronDownIcon } from "./icons";

const PILLARS = [
  { id: "studio", label: "Content Studio", href: "/simple-studio/images" },
  { id: "editor", label: "Video Editor", href: "/editor/projects" },
  { id: "social", label: "Social Hub", href: "/social" },
  { id: "analytics", label: "Analytics", href: "/social/analytics" },
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
        className="flex items-center gap-1.5 rounded-[5px] border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-green-400 transition-all duration-150 hover:border-neutral-700 hover:bg-neutral-800"
      >
        <ChannelsIcon size={12} />
        <span>{current.label}</span>
        <ChevronDownIcon
          size={10}
          className={`text-neutral-600 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-neutral-800 bg-neutral-900 py-1 shadow-lg">
          {PILLARS.map((pillar) => (
            <Link
              key={pillar.id}
              href={pillar.href}
              onClick={() => setIsOpen(false)}
              className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                pillar.id === currentPillar
                  ? "bg-neutral-800 text-green-400"
                  : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
              }`}
            >
              <span>{pillar.label}</span>
              {pillar.id === currentPillar && (
                <span className="ms-auto text-[9px] text-neutral-600">
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
