import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UGC Studio — Ürün tanıtım videonu oluştur",
  description: "Ürün fotoğrafı, model ve konuşma metniyle dikey UGC tanıtım videosu üret.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
