'use client';

/**
 * Custom global error page.
 *
 * Næste 16 + Turbopack's auto-generated /_global-error fejler ved prerender
 * (Cannot read properties of null reading 'useContext'). En custom version
 * uden hooks/context omgår problemet.
 */
export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="da">
      <body>
        <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
          <h1>Noget gik galt</h1>
          <p>Der opstod en uventet fejl. Prøv at genindlæse siden.</p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#0f172a',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            Prøv igen
          </button>
        </div>
      </body>
    </html>
  );
}
