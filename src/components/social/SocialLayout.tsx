"use client";

import { useEffect } from "react";
import { useSocialAccountsStore } from "@/store/socialAccountsStore";
import { SocialHeader } from "./SocialHeader";
import { SocialSidebar } from "./SocialSidebar";

interface SocialLayoutProps {
  children: React.ReactNode;
}

export function SocialLayout({ children }: SocialLayoutProps) {
  const fetchAccounts = useSocialAccountsStore((s) => s.fetchAccounts);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-neutral-100">
      <SocialSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <SocialHeader />
        <main className="flex flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
