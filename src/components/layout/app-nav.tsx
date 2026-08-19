"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Album,
  Archive,
  Globe2,
  Heart,
  Image as ImageIcon,
  Map,
  Plane,
  Settings,
  Shield,
  Trash2,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: typeof ImageIcon;
};

type NavSection = {
  title: string | null;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: null,
    items: [
      { label: "Photos", href: "/", icon: ImageIcon },
      { label: "Map", href: "/map", icon: Map },
    ],
  },
  {
    title: "Library",
    items: [
      { label: "Favourites", href: "/favorites", icon: Heart },
      { label: "Albums", href: "/albums", icon: Album },
      { label: "Flights", href: "/flights", icon: Plane },
      { label: "Community", href: "/community", icon: Globe2 },
      { label: "Bin", href: "/bin", icon: Trash2 },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Drones", href: "/drones", icon: Archive },
      { label: "Utilities", href: "/utilities", icon: Wrench },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function AppNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const sections = showAdmin
    ? [
        ...navSections,
        {
          title: "Admin",
          items: [{ label: "Administration", href: "/admin", icon: Shield }],
        },
      ]
    : navSections;

  return (
    <nav className="dm-scrollbar flex-1 space-y-4 overflow-y-auto py-3">
      {sections.map((section) => (
        <div key={section.title ?? "top"}>
          {section.title ? (
            <p className="mb-1.5 px-6 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {section.title}
            </p>
          ) : null}
          <div className="space-y-1">
            {section.items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 py-2.5 pl-6 pr-4 text-base font-medium transition-colors",
                    active
                      ? "dm-nav-active mr-4 rounded-r-full bg-[#2c3138] text-[#acccfa]"
                      : "mr-4 rounded-r-full text-sidebar-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5 shrink-0",
                      active ? "text-[#acccfa]" : "text-muted-foreground",
                    )}
                  />
                  <span className="truncate text-base font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
