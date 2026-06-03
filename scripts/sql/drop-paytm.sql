-- =====================================================================
-- Drop ALL Paytm schema objects from Supabase (Phase 1 of the
-- Paytm → PhonePe rework).
--
-- WHAT IT REMOVES
--   • Table        public.paytm_payment_events  (every Paytm webhook row)
--   • Columns      tenant_payment_gateways.{paytm_mid, paytm_merchant_key,
--                  paytm_enabled, paytm_env, paytm_mid_staging,
--                  paytm_merchant_key_staging}
--   • Constraint   tpg_paytm_env_check
--   • Index        idx_tpg_paytm_mid
--   • Enum value   'paytm' is removed from tenants.payment_gateway_check
--                  (replaced by 'phonepe')
--   • Enum value   'PAYTM' is removed from payments.method_check
--                  (replaced by historical migration to 'PHONEPE')
--
-- WHAT IT PRESERVES
--   • Historical payment rows that were recorded as method='PAYTM' are
--     UPDATED to method='PHONEPE' BEFORE the enum value is dropped, so
--     no row ever fails the new check constraint and the visible "an
--     online UPI gateway was used" fact survives on old bills.
--   • Tenants currently configured with payment_gateway='paytm' are
--     UPDATED to payment_gateway='phonepe' for the same reason.
--
-- HOW TO USE
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste the WHOLE file.
--   3. Optional sanity check first — run just the SELECT block below to
--      see how many rows will be migrated. If the numbers surprise you,
--      stop and investigate. Otherwise hit Run.
--
-- IDEMPOTENT
--   Uses IF EXISTS / IF NOT EXISTS throughout so re-running on a
--   partially-applied database is safe.
-- =====================================================================

-- ── 0. Sanity-check block — uncomment to preview impact before running.
-- SELECT
--     (SELECT count(*) FROM public.payments WHERE method = 'PAYTM')                   AS paytm_payment_rows,
--     (SELECT count(*) FROM public.tenants  WHERE payment_gateway = 'paytm')          AS paytm_configured_tenants,
--     (SELECT count(*) FROM public.paytm_payment_events)                              AS paytm_event_rows;


BEGIN;

-- ── 1. Drop the OLD check constraints FIRST so the UPDATEs below can
--      change values to 'phonepe' / 'PHONEPE' without violating the
--      still-active check that only allows 'paytm' / 'PAYTM'. We
--      re-add tightened constraints at the end once the data is
--      migrated. (An earlier version of this script ran the UPDATE
--      first and hit `23514 violates check constraint
--      tenants_payment_gateway_check`.)
ALTER TABLE public.tenants
    DROP CONSTRAINT IF EXISTS tenants_payment_gateway_check;

-- The payments.method check is auto-named (usually
-- `payments_method_check` but the name can drift across migration
-- histories). Find it by inspecting the constraint definition for the
-- word "method" + the table name, then drop.
DO $$
DECLARE
    v_constraint_name text;
BEGIN
    SELECT con.conname INTO v_constraint_name
      FROM pg_constraint con
      JOIN pg_class      cls ON cls.oid = con.conrelid
      JOIN pg_namespace  nsp ON nsp.oid = cls.relnamespace
     WHERE nsp.nspname = 'public'
       AND cls.relname = 'payments'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%method%'
     LIMIT 1;
    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.payments DROP CONSTRAINT %I',
            v_constraint_name
        );
    END IF;
END $$;

-- ── 2. Migrate historical PAYTM payment rows to PHONEPE so the audit
--      trail survives once the enum value 'PAYTM' is removed. The bill
--      still reads "paid via an online UPI rail", just relabelled.
UPDATE public.payments
   SET method = 'PHONEPE'
 WHERE method = 'PAYTM';

-- ── 3. Re-point tenants currently configured for 'paytm' so the new
--      constraint below accepts them.
UPDATE public.tenants
   SET payment_gateway = 'phonepe'
 WHERE payment_gateway = 'paytm';

-- ── 4. Drop the per-tenant Paytm event-log table (and its indexes).
--      CASCADE handles any dependent objects (the table's own foreign
--      keys were defined inline; nothing external references it).
DROP INDEX IF EXISTS public.idx_paytm_events_tenant_status;
DROP TABLE IF EXISTS public.paytm_payment_events CASCADE;

-- ── 5. Drop the env check + index that lived on the gateway table.
--      Some pg versions drop these alongside the column; do it
--      explicitly to be portable across versions.
ALTER TABLE public.tenant_payment_gateways
    DROP CONSTRAINT IF EXISTS tpg_paytm_env_check;
DROP INDEX IF EXISTS public.idx_tpg_paytm_mid;

-- ── 6. Drop every paytm_* column from tenant_payment_gateways.
ALTER TABLE public.tenant_payment_gateways DROP COLUMN IF EXISTS paytm_mid;
ALTER TABLE public.tenant_payment_gateways DROP COLUMN IF EXISTS paytm_merchant_key;
ALTER TABLE public.tenant_payment_gateways DROP COLUMN IF EXISTS paytm_enabled;
ALTER TABLE public.tenant_payment_gateways DROP COLUMN IF EXISTS paytm_env;
ALTER TABLE public.tenant_payment_gateways DROP COLUMN IF EXISTS paytm_mid_staging;
ALTER TABLE public.tenant_payment_gateways DROP COLUMN IF EXISTS paytm_merchant_key_staging;

-- ── 7. Re-add the tightened tenants.payment_gateway check. No row is
--      on 'paytm' anymore (step 3 above moved them all), so the
--      validation pass succeeds.
ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_payment_gateway_check
    CHECK (payment_gateway IN ('manual', 'phonepe', 'stripe'));

-- ── 8. Re-add the tightened payments.method check — 'PAYTM' removed.
ALTER TABLE public.payments
    ADD CONSTRAINT payments_method_check
    CHECK (method IN (
        'CASH', 'UPI', 'CARD', 'RAZORPAY', 'PHONEPE', 'STRIPE',
        'BANK_TRANSFER', 'CREDIT', 'COMPLIMENTARY', 'OTHER'
    ));

COMMIT;

-- ── 9. Final sanity check (informational — not a transaction). Should
--      all return 0 if the script ran cleanly. If any return > 0, the
--      script left rows behind; investigate before considering Phase 1
--      complete.
SELECT
    (SELECT count(*) FROM public.payments WHERE method = 'PAYTM')                                                              AS leftover_paytm_payments,
    (SELECT count(*) FROM public.tenants  WHERE payment_gateway = 'paytm')                                                     AS leftover_paytm_tenants,
    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenant_payment_gateways'
        AND column_name LIKE 'paytm%')                                                                                          AS leftover_paytm_columns,
    (SELECT count(*) FROM information_schema.tables  WHERE table_schema = 'public' AND table_name = 'paytm_payment_events')   AS leftover_paytm_table;
