"use client";

import {
  BookOpenText,
  Clapperboard,
  FolderKanban,
  Gauge,
  HardDrive,
  MessageSquare,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Studio", icon: Gauge },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/kdp", label: "KDP Story Studio", icon: BookOpenText },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="AI Film Studio home">
          <span className="brand-mark">
            <Clapperboard size={20} />
          </span>
          <span>
            <strong>Film Studio</strong>
            <small>AI production desk</small>
          </span>
        </Link>
        <nav aria-label="Primary navigation">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={active ? "nav-link active" : "nav-link"}
              >
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
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
              <Clapperboard size={18} />
            </span>
            <strong>Film Studio</strong>
          </Link>
          <nav aria-label="Mobile navigation">
            {navigation.map(({ href, label, icon: Icon }) => (
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
