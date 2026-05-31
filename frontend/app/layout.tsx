import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ChordScope",
  description: "Review and analyze your guitar recordings",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ 
        margin: 0, 
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        background: "#111",
        color: "#eee"
      }}>
        {children}
      </body>
    </html>
  );
}
