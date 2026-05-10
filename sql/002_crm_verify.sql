-- ============================================================
-- iBuyReal CRM — schema verification
-- Run after 001_crm_bootstrap.sql to confirm all objects exist.
-- Run with: psql -d <your_db> -f sql/002_crm_verify.sql
-- Expected: every SELECT should return at least 1 row.
-- ============================================================

\echo ''
\echo '=== Tables in crm schema ==='
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'crm'
  AND table_type   = 'BASE TABLE'
ORDER BY table_name;

\echo ''
\echo '=== Expected: investors, properties, assumptions, on_market_candidates ==='

\echo ''
\echo '=== Missing tables (should be empty) ==='
SELECT expected.name AS missing_table
FROM (VALUES
    ('investors'),
    ('properties'),
    ('assumptions'),
    ('on_market_candidates')
) AS expected(name)
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'crm'
      AND t.table_name   = expected.name
);

\echo ''
\echo '=== Indexes in crm schema ==='
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'crm'
ORDER BY tablename, indexname;

\echo ''
\echo '=== Foreign key constraints in crm schema ==='
SELECT
    c.conname            AS constraint_name,
    c.contype            AS type,
    rel.relname          AS table_name,
    ref.relname          AS references_table
FROM pg_constraint c
JOIN pg_class     rel ON rel.oid = c.conrelid
JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
LEFT JOIN pg_class ref ON ref.oid = c.confrelid
WHERE ns.nspname = 'crm'
  AND c.contype  = 'f'
ORDER BY rel.relname;

\echo ''
\echo '=== Default assumptions row ==='
SELECT id, updated_at FROM crm.assumptions WHERE id = 'default';

\echo ''
\echo '=== Verification complete ==='
