"use client";

import {
  BookOpenText,
  ChevronDown,
  Clapperboard,
  FolderKanban,
  Gauge,
  HardDrive,
  MessageSquare,
  Settings,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; icon: LucideIcon; items: NavItem[] };

const navigation: Array<NavItem | NavGroup> = [
  {
    label: "Film Studio",
    icon: Clapperboard,
    items: [
      { href: "/", label: "Studio", icon: Gauge },
      { href: "/projects", label: "Projects", icon: FolderKanban },
    ],
  },
  { href: "/kdp", label: "KDP Story Studio", icon: BookOpenText },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

const navItems = navigation.flatMap((entry) =>
  "items" in entry ? entry.items : [entry],
);

function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLink({
  item,
  pathname,
  className = "nav-link",
}: {
  item: NavItem;
  pathname: string;
  className?: string;
}) {
  const Icon = item.icon;
  const active = isActive(item.href, pathname);
  return (
    <Link
      href={item.href}
      className={active ? `${className} active` : className}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={18} />
      <span>{item.label}</span>
    </Link>
  );
}

function NavGroupLinks({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const [open, setOpen] = useState(true);
  const Icon = group.icon;
  const containsActive = group.items.some((item) =>
    isActive(item.href, pathname),
  );
  return (
    <div className="nav-group">
      <button
        type="button"
        className={
          containsActive
            ? "nav-link nav-group-toggle current"
            : "nav-link nav-group-toggle"
        }
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon size={18} />
        <span>{group.label}</span>
        <ChevronDown className="nav-chevron" size={16} />
      </button>
      {open && (
        <div className="nav-group-items">
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              className="nav-link nav-sublink"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="AI Studio home">
          <span className="brand-mark">
            <WandSparkles size={20} />
          </span>
          <span>
            <strong>AI Studio</strong>
            <small>Films &amp; books desk</small>
          </span>
        </Link>
        <nav aria-label="Primary navigation">
          {navigation.map((entry) =>
            "items" in entry ? (
              <NavGroupLinks
                key={entry.label}
                group={entry}
                pathname={pathname}
              />
            ) : (
              <NavLink key={entry.href} item={entry} pathname={pathname} />
            ),
          )}
        </nav>
        <div className="sidebar-spacer" />
        <div className="local-badge">
          <HardDrive size={17} />
          <span>
            <strong>Local workspace</strong>
            <small>Private on this Mac</small>
          </span>
          <i aria-hidden="true" />
        </div>
        <div className="phase-card">
          <Sparkles size={16} />
          <p>
            <strong>Video production</strong>
            <br />
            Manual · Kling · Seedance
          </p>
          <span>Phase 6</span>
        </div>
      </aside>
      <div className="content-frame">
        <header className="mobile-header">
          <Link className="brand" href="/">
            <span className="brand-mark">
              <WandSparkles size={18} />
            </span>
            <strong>AI Studio</strong>
          </Link>
          <nav aria-label="Mobile navigation">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-label={label}>
                <Icon size={19} />
              </Link>
            ))}
          </nav>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
