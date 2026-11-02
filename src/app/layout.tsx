import type { Metadata } from "next";
import "./globals.css";
import "./dossier.css";

export const metadata: Metadata = {
  title: "Fieldnote | Credit research",
  description: "Private, source-backed company research memos",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
