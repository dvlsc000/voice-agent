import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Reception', template: `%s · ${process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Reception'}` },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f4f6f7' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
