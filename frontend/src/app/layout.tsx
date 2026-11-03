import type { Metadata } from "next";
import "./globals.css";
import "./dossier.css";
import "./demo.css";

export const metadata: Metadata = {
  title: "J.P. Morgan | Company research demo",
  description: "DS3 Consulting project demo: saved two-page company research examples",
  icons: { icon: "/brand/jpmorgan.svg" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
