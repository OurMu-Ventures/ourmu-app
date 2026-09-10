"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  BadgeCheck,
  Briefcase,
  History,
  Inbox,
  LayoutDashboard,
  Mail,
  Menu,
  RefreshCw,
  ScrollText,
  Settings,
  TrendingUp,
  Upload,
  User,
  Users,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";

import { LinkStatus } from "@/components/ui/link-status";
import { cn } from "@/lib/utils";

export type ShellLink = {
  href: string;
  label: string;
  status: string;
};

const icons: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/profile": User,
  "/investments/new": TrendingUp,
  "/investments": Briefcase,
  "/account/closure": UserX,
  "/admin": LayoutDashboard,
  "/admin/invitations": Mail,
  "/admin/applications": Inbox,
  "/admin/investors": Users,
  "/admin/imports": Upload,
  "/admin/cycles": RefreshCw,
  "/admin/investments": BadgeCheck,
  "/admin/audit": ScrollText,
  "/admin/jobs": History,
  "/admin/settings": Settings,
};

// Section navigation: a static sidebar on desktop, and a hamburger-driven
// drawer on mobile. The drawer traps no complexity: Escape closes it,
// focus returns to the toggle, background scroll locks, and the current
// page is marked with aria-current plus a visible highlight.
export function ShellNav({
  links,
  label,
}: {
  links: ShellLink[];
  label: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    // A completed navigation (link tap, back/forward) dismisses the drawer.
    setLastPath(pathname);
    setOpen(false);
  }
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const navId = useId();
  const current =
    links.find((link) => pathname === link.href) ??
    [...links]
      .sort((a, b) => b.href.length - a.href.length)
      .find((link) => pathname.startsWith(`${link.href}/`));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open ]);

  useEffect(() => {
    if (wasOpen.current && !open) toggleRef.current?.focus();
    wasOpen.current = open;
  }, [open ]);

  return (
    <>
      <div className="shell-bar">
        <button
          ref={toggleRef}
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-controls={navId}
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <span className="shell-bar-current">
          {current?.label ?? label}
        </span>
      </div>
      {open && (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <nav
        ref={panelRef}
        id={navId}
        tabIndex={-1}
        aria-label={label}
        className={cn("side-nav", open && "open")}
      >
        <button
          type="button"
          className="nav-toggle nav-close"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        >
          <X aria-hidden="true" />
        </button>
        {links.map((link) => {
          const Icon = icons[link.href];
          const active = pathname === link.href;
          return (
            <Link
              href={link.href}
              key={link.href}
              aria-current={active ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {Icon && <Icon className="nav-icon" aria-hidden="true" />}
              {link.label} <LinkStatus label={link.status} />
            </Link>
          );
        })}
      </nav>
    </>
  );
}
