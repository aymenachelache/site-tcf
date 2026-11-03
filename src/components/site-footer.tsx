"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <Link className="site-footer-brand" href="/">TCF Simulation</Link>
        <nav className="site-footer-links" aria-label="Liens de pied de page">
          <Link href="/examen">Examens blancs</Link>
          <Link href="/tarifs">Tarifs</Link>
          <Link href="/mes-acces">Mes accès</Link>
          <Link href="/login">Connexion</Link>
        </nav>
      </div>
    </footer>
  );
}
