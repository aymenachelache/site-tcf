import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "TCF Simulation | Préparation aux examens blancs",
  description: "Plateforme de préparation au TCF avec parcours utilisateur, admin et moteur d’examen.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
