'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ImportButton() {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/properties/import', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Import fejlede: ${res.status}`);
      }
      const data = (await res.json()) as { count: number };
      alert(`Importerede ${data.count} cases.`);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ukendt fejl');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFile}
        className="hidden"
      />
      <button
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? 'Importerer...' : 'Importér Excel'}
      </button>
    </>
  );
}
