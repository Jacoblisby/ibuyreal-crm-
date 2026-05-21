import type { Metadata } from 'next';
import Link from 'next/link';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'iBuyReal CRM',
  description: 'iBuyReal — boligberegner og deal pipeline',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className="h-full antialiased">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
            <Link href="/" className="text-base font-semibold tracking-tight">
              iBuyReal <span className="text-slate-400">CRM</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm text-slate-600">
              {[
                { href: '/', label: 'Dashboard' },
                { href: '/calculator', label: 'Boligberegner' },
                { href: '/on-market', label: 'On-market' },
                { href: '/market-overview', label: 'Marked' },
                { href: '/screening', label: 'Screening' },
                { href: '/pipeline', label: 'Pipeline' },
                { href: '/investors', label: 'Investorer' },
                { href: '/settings', label: 'Antagelser' },
                { href: '/admin/external-sales', label: 'Resight' },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-slate-600 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        <Toaster
          position="bottom-right"
          closeButton
          richColors
          toastOptions={{
            classNames: {
              toast: 'font-sans',
            },
          }}
        />
      </body>
    </html>
  );
}
