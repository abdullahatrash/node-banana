"use client";

import type { ReactNode } from "react";

interface FormPageLayoutProps {
  children: ReactNode;
  infoPanel: ReactNode;
}

export function FormPageLayout({ children, infoPanel }: FormPageLayoutProps) {
  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 lg:flex-row">
      <div className="flex-1">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </div>
      <aside className="lg:w-80 lg:shrink-0">{infoPanel}</aside>
    </main>
  );
}
