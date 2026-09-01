import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Athena",
  description: "Franchise candidate intelligence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0B0F17] text-[#E2E8F0] antialiased">{children}</body>
    </html>
  );
}
