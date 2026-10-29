import type { Metadata } from "next";
import type { ReactNode } from "react";

import { KdpSectionNav } from "@/components/kdp/kdp-ui";

export const metadata: Metadata = {
  title: { default: "KDP Story Studio", template: "%s · KDP Story Studio" },
};

export default function KdpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kdp-area">
      <KdpSectionNav />
      {children}
    </div>
  );
}
