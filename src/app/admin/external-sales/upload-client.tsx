'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface UploadResult {
  ok: boolean;
  totalRead: number;
  totalValid: number;
  totalUpserted: number;
  filesProcessed: Array<{ name: string; rows: number; valid: number; upserted: number }>;
}

export function ExternalSalesUploadClient() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragging, setDragging] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith('.xlsx'),
    );
    if (dropped.length === 0) {
      toast.error('Drop kun .xlsx-filer fra Resight');
      return;
    }
    setFiles(dropped);
  }

  async function upload() {
    if (files.length === 0) return;
    setBusy(true);
    setResult(null);
    const t = toast.loading(`Uploader ${files.length} fil${files.length === 1 ? '' : 'er'}…`);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('file', f);
      const r = await fetch('/api/external-sales/upload', { method: 'POST', body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Upload fejlede');
      }
      const data = (await r.json()) as UploadResult;
      setResult(data);
      toast.success(
        `${data.totalUpserted} handler upsertet fra ${data.filesProcessed.length} filer`,
        { id: t },
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fejl', { id: t });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={
          'rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-150 ease-[var(--ease-out)] ' +
          (dragging
            ? 'border-emerald-400 bg-emerald-50/40'
            : 'border-slate-300 bg-slate-50/40 hover:border-slate-400')
        }
      >
        <svg className="mx-auto h-8 w-8 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="mt-2 text-sm font-medium text-slate-700">
          Drop TransactionsExport-*.xlsx her
        </p>
        <p className="text-xs text-slate-500">eller</p>
        <label className="mt-2 inline-block cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.97]">
          Vælg filer fra disken
          <input
            type="file"
            accept=".xlsx"
            multiple
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
      </div>

      {files.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            Klar til upload ({files.length})
          </div>
          <ul className="space-y-1 text-slate-700">
            {files.map((f) => (
              <li key={f.name} className="flex items-center justify-between">
                <span className="font-mono text-xs">{f.name}</span>
                <span className="text-xs text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              onClick={upload}
              disabled={busy}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.97] disabled:opacity-50"
            >
              {busy ? 'Uploader…' : `Upload ${files.length} fil${files.length === 1 ? '' : 'er'}`}
            </button>
            <button
              onClick={() => setFiles([])}
              disabled={busy}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 active:scale-[0.97]"
            >
              Annuller
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-sm">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-700">
            Færdig — {result.totalUpserted} handler upsertet
          </div>
          <ul className="space-y-1 text-xs text-slate-700">
            {result.filesProcessed.map((f) => (
              <li key={f.name} className="flex items-center justify-between">
                <span className="font-mono">{f.name}</span>
                <span className="tabular-nums text-slate-500">
                  {f.rows} read · {f.valid} valid · {f.upserted} upserted
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
