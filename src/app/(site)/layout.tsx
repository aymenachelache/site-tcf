import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteNavigation } from "@/components/site-navigation";
import "./site.css";

export default function SiteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="site-shell">
      <SiteNavigation />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
