import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Historical Event Visualizer",
  description: "世界史のイベントを時間発展する世界地図に可視化する",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
