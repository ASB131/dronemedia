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
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: "Library",
    items: [
      { label: "Photos", href: "/", icon: ImageIcon },
      { label: "Favorites", href: "/favorites", icon: Heart },
      { label: "Albums", href: "/albums", icon: Album },
      { label: "Bin", href: "/bin", icon: Trash2 },
    ],
  },
  {
    title: "Explore",
    items: [
      { label: "Map", href: "/map", icon: Map },
      { label: "Flights", href: "/flights", icon: Plane },
      { label: "Community", href: "/community", icon: Globe2 },
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
          items: [
            { label: "Administration", href: "/admin", icon: Shield },
          ],
        },
      ]
    : navSections;

  return (
    <nav className="dm-scrollbar flex-1 space-y-4 overflow-y-auto px-3 py-3">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
            {section.title}
          </p>
          <div className="space-y-0.5">
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
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "dm-nav-active bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
