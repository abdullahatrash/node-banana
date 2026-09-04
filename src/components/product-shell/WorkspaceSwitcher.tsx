"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, PanelsTopLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/studio/client";
import type { ProductShellWorkspace } from "@/lib/product-shell/server";

interface WorkspaceSwitcherProps {
  workspaces: ProductShellWorkspace[];
  initialWorkspaceId: string | null;
}

export function WorkspaceSwitcher({
  workspaces,
  initialWorkspaceId,
}: WorkspaceSwitcherProps) {
  const t = useTranslations("shell.workspace");
  const [activeWorkspaceId, setActiveId] = useState(initialWorkspaceId);

  useEffect(() => {
    const stored = getActiveWorkspaceId();
    const next = workspaces.some((workspace) => workspace.id === stored)
      ? stored
      : initialWorkspaceId;
    setActiveId(next);
    setActiveWorkspaceId(next);
    if (next) void persistServerWorkspace(next);
  }, [initialWorkspaceId, workspaces]);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  async function selectWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    setActiveWorkspaceId(workspaceId);
    setActiveId(workspaceId);
    await persistServerWorkspace(workspaceId);
    window.location.reload();
  }

  if (workspaces.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton disabled tooltip={t("empty")}>
            <PanelsTopLeftIcon />
            <span>{t("empty")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={activeWorkspace?.name ?? t("selectionRequired")}
              />
            }
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <PanelsTopLeftIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1 text-start">
              <span className="block truncate text-sm font-semibold">
                {activeWorkspace?.name ?? t("select")}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {activeWorkspace
                  ? t(activeWorkspace.role)
                  : t("selectionRequired")}
              </span>
            </span>
            <ChevronsUpDownIcon className="ms-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start" sideOffset={6}>
            <DropdownMenuLabel>{t("select")}</DropdownMenuLabel>
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onSelect={() => void selectWorkspace(workspace.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{workspace.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(workspace.role)}
                  </span>
                </span>
                {workspace.id === activeWorkspace?.id ? (
                  <CheckIcon className="ms-auto size-4" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

async function persistServerWorkspace(workspaceId: string) {
  await fetch("/api/preferences/workspace", {
    method: "POST",
    headers: { "x-workspace-id": workspaceId },
    keepalive: true,
  }).catch(() => null);
}
