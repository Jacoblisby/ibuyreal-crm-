import type { Metadata } from 'next';
import Link from 'next/link';
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
            <nav className="flex items-center gap-6 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">Dashboard</Link>
              <Link href="/calculator" className="hover:text-slate-900">Boligberegner</Link>
              <Link href="/on-market" className="hover:text-slate-900">On-market</Link>
              <Link href="/screening" className="hover:text-slate-900">Screening</Link>
              <Link href="/pipeline" className="hover:text-slate-900">Pipeline</Link>
              <Link href="/investors" className="hover:text-slate-900">Investorer</Link>
              <Link href="/settings" className="hover:text-slate-900">Antagelser</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
