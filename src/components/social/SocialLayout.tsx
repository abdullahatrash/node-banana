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
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <SocialHeader />
      <div className="flex flex-1 overflow-hidden">
        <SocialSidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
