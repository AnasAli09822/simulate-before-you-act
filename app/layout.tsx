import type { Metadata } from "next";
import { ArchitecturePanel } from "./ArchitecturePanel";
import "./globals.css";
import "./architecture.css";

export const metadata: Metadata = {
  title: "Foresee — Simulate Before You Act",
  description: "See the consequences before your agent acts.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ArchitecturePanel />
      </body>
    </html>
  );
}
