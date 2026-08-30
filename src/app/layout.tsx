import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Portfolio Intelligence',
  description: 'AI-assisted, thesis-driven investment management with a deterministic quantitative engine',
};

/**
 * Without this the browser assumes a desktop-width layout and scales the whole
 * page down on a phone: text becomes unreadable, and every tap target shrinks
 * below the size a thumb can hit. It was absent, which made every other
 * touch-sizing rule in globals.css moot on the device that needed them.
 *
 * maximumScale and userScalable are deliberately left at their defaults —
 * blocking zoom is a common companion to this tag and an accessibility
 * failure; a reader who needs to magnify a number must be able to.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce-based CSP requires request-time rendering so Next can apply the
  // proxy-provided nonce to its bootstrap scripts.
  await headers();
  return (
    <html lang="en">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
