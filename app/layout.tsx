import "./globals.css";
export const metadata = { title: "Flow", description: "Tasks, calendar, timeline and notes" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
