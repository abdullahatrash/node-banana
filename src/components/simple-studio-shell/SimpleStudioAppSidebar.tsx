"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ImageIcon,
  VideoIcon,
  FileTextIcon,
  GalleryThumbnailsIcon,
  BookmarkIcon,
  PaletteIcon,
} from "lucide-react";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { AppSwitcher } from "@/components/AppSwitcher";
import { authClient } from "@/lib/auth/client";
import { useTranslations } from "next-intl";

const CREATE_ITEMS = [
  { href: "/simple-studio/images", key: "images", icon: ImageIcon },
  { href: "/simple-studio/videos", key: "videos", icon: VideoIcon },
  { href: "/simple-studio/copy", key: "copy", icon: FileTextIcon },
] as const;

const BROWSE_ITEMS = [
  { href: "/simple-studio/library", key: "library", icon: GalleryThumbnailsIcon },
  { href: "/simple-studio/prompt-library", key: "promptLibrary", icon: BookmarkIcon },
] as const;

export function SimpleStudioAppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const session = authClient.useSession();
  const t = useTranslations("shell");

  const user = {
    name: session.data?.user?.name || t("userFallback"),
    email: session.data?.user?.email || "",
    avatar: session.data?.user?.image || "",
  };

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <AppSwitcher>
              <div className="flex w-full items-center gap-2 rounded-md p-1.5 text-start text-sm font-semibold hover:bg-sidebar-accent cursor-pointer">
                <PaletteIcon className="size-5" />
                <span className="text-base font-semibold">{t("areas.simpleStudio")}</span>
              </div>
            </AppSwitcher>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("groups.create")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {CREATE_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{t(`routes.${item.key}`)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>{t("groups.browse")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {BROWSE_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{t(`routes.${item.key}`)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
