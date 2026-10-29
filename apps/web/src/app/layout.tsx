import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

import "./globals.css";
import "./kdp.css";
import "./kdp-library.css";
import "./kdp-writing.css";
import "./kdp-publishing.css";

export const metadata: Metadata = {
  title: { default: "AI Film Studio", template: "%s · AI Film Studio" },
  description: "A private, local-first AI filmmaking workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
