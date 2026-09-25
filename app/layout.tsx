import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Flow", description: "Tasks, calendar, timeline and notes" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
