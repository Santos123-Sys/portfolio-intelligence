import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Portfolio Intelligence',
  description: 'AI-assisted, thesis-driven investment management with a deterministic quantitative engine',
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
