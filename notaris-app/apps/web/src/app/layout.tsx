import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Kantor Notaris', template: '%s · Kantor Notaris' },
  description: 'Manajemen berkas, akta, dan buku daftar kantor Notaris & PPAT',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#1c2541' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
