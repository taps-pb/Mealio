import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Mealio",
  description: "Private mobile meal tracker",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7fcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#331e38" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" data-theme="light"><body>{children}</body></html>;
}
