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

const CREATE_ITEMS = [
  { href: "/simple-studio/images", label: "Images", icon: ImageIcon },
  { href: "/simple-studio/videos", label: "Videos", icon: VideoIcon },
  { href: "/simple-studio/copy", label: "Copy", icon: FileTextIcon },
];

const BROWSE_ITEMS = [
  { href: "/simple-studio/library", label: "Library", icon: GalleryThumbnailsIcon },
  { href: "/simple-studio/prompt-library", label: "Prompt Library", icon: BookmarkIcon },
];

export function SimpleStudioAppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const session = authClient.useSession();

  const user = {
    name: session.data?.user?.name || "User",
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
                <span className="text-base font-semibold">Simple Studio</span>
              </div>
            </AppSwitcher>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Create</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {CREATE_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Browse</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {BROWSE_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
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
