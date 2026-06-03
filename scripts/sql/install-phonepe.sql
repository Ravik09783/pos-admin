-- =====================================================================
-- Install the PhonePe schema (Phase 2 of the Paytm → PhonePe rework).
--
-- WHAT IT CREATES
--   • Per-tenant credentials columns on tenant_payment_gateways:
--       phonepe_mid               (production Merchant ID)
--       phonepe_merchant_key      (production Salt Key)
--       phonepe_salt_index        (production Salt Index, default '1')
--       phonepe_mid_staging       (UAT/test Merchant ID)
--       phonepe_merchant_key_staging
--       phonepe_salt_index_staging
--       phonepe_enabled           (boolean — payments only fire when true)
--       phonepe_env               ('staging' | 'production', default 'staging')
--   • Check constraint on phonepe_env
--   • Lookup index on phonepe_mid (the webhook needs this — it routes by
--     Merchant ID + transaction id, and a sequential scan on every
--     PhonePe retry would be wasteful)
--   • phonepe_payment_events table — one row per PhonePe transaction we
--     mint. Webhook + reconcile cron find rows by `merchant_transaction_id`
--     and flip status to SUCCESS/FAILED idempotently.
--
-- HOW TO USE
--   Paste the whole file into the Supabase SQL Editor and Run.
--
-- IDEMPOTENT: Uses IF NOT EXISTS / DO blocks so re-running is a no-op.
--
-- PREREQUISITE: run scripts/sql/drop-paytm.sql first if you haven't.
-- =====================================================================

BEGIN;

-- ── 1. tenant_payment_gateways columns ─────────────────────────────
ALTER TABLE public.tenant_payment_gateways
    ADD COLUMN IF NOT EXISTS phonepe_mid                  text,
    ADD COLUMN IF NOT EXISTS phonepe_merchant_key         text,
    ADD COLUMN IF NOT EXISTS phonepe_salt_index           text DEFAULT '1',
    ADD COLUMN IF NOT EXISTS phonepe_mid_staging          text,
    ADD COLUMN IF NOT EXISTS phonepe_merchant_key_staging text,
    ADD COLUMN IF NOT EXISTS phonepe_salt_index_staging   text DEFAULT '1',
    ADD COLUMN IF NOT EXISTS phonepe_enabled              boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS phonepe_env                  text NOT NULL DEFAULT 'staging';

COMMENT ON COLUMN public.tenant_payment_gateways.phonepe_mid IS
    'PhonePe Business Merchant ID for the PRODUCTION environment. The UAT (test) equivalent lives in phonepe_mid_staging; phonepe_env picks the active pair.';
COMMENT ON COLUMN public.tenant_payment_gateways.phonepe_merchant_key IS
    'PhonePe Salt Key for the PRODUCTION environment. Used to sign every API call AND to verify the webhook''s X-VERIFY header. Treated as a secret — RLS makes it readable by the tenant''s OWNER only.';
COMMENT ON COLUMN public.tenant_payment_gateways.phonepe_salt_index IS
    'PhonePe Salt Index — small integer (usually "1") PhonePe gives you alongside the Salt Key. Appended to X-VERIFY as `<hash>###<index>`.';
COMMENT ON COLUMN public.tenant_payment_gateways.phonepe_env IS
    '''staging'' uses PhonePe''s UAT preprod endpoints with the staging key pair; ''production'' uses the live endpoints with the prod pair. Restaurants typically start on ''staging'' for end-to-end testing, then flip to ''production'' once their PhonePe account goes live.';

-- Env check constraint — only ever the two known values.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'tpg_phonepe_env_check'
    ) THEN
        ALTER TABLE public.tenant_payment_gateways
            ADD CONSTRAINT tpg_phonepe_env_check
            CHECK (phonepe_env IN ('staging', 'production'));
    END IF;
END $$;

-- Lookup index — the webhook receives a payload that names the
-- transaction-id; we then load `phonepe_payment_events` by that key
-- and finally need the tenant's credentials by `phonepe_mid`. Partial
-- index — only rows that actually have a Merchant ID populated are
-- worth indexing.
CREATE INDEX IF NOT EXISTS idx_tpg_phonepe_mid
    ON public.tenant_payment_gateways (phonepe_mid)
    WHERE phonepe_mid IS NOT NULL;


-- ── 2. phonepe_payment_events — one row per mint ───────────────────
--
-- merchant_transaction_id is the id we generate per attempt and send to
-- PhonePe. PhonePe echoes it on the webhook AND on the poll-status
-- response. PRIMARY KEY means the webhook handler can rely on it being
-- unique for idempotency without an extra unique index.
--
-- `flow` distinguishes a staff-fired POS bill (`POS`) from a customer-
-- placed QR-ordering checkout (`QR_ORDER`) so reports + the reconcile
-- cron can treat them differently. New flows can be added by extending
-- the check constraint — keep it tight on purpose.
CREATE TABLE IF NOT EXISTS public.phonepe_payment_events (
    merchant_transaction_id text PRIMARY KEY,
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    order_id                uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    display_session_id      uuid,
    bill_id                 uuid REFERENCES public.bills(id) ON DELETE SET NULL,
    amount                  numeric(12,2) NOT NULL,
    currency                text NOT NULL DEFAULT 'INR',
    flow                    text NOT NULL DEFAULT 'POS'
                            CHECK (flow IN ('POS', 'QR_ORDER')),
    status                  text NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
    -- PhonePe's own transaction id, stamped by the webhook on completion.
    provider_txn_id         text,
    -- Full webhook / poll-status payload, kept for reconciliation +
    -- dispute evidence. Always the latest snapshot.
    raw                     jsonb,
    created_at              timestamptz DEFAULT now(),
    processed_at            timestamptz
);

-- Reconcile-cron scan index. The cron grabs every PENDING row that's
-- older than ~3 minutes (long enough for the webhook to have arrived
-- on a healthy day) and younger than 24 h (older than that = abandoned).
-- This index keeps that scan tight.
CREATE INDEX IF NOT EXISTS idx_phonepe_events_tenant_status
    ON public.phonepe_payment_events (tenant_id, status, created_at DESC);

-- RLS on, NO policies — same model as paytm_payment_events was on
-- (and stripe_webhook_events still is): this table is touched only by
-- service-role code paths (the create-payment route, the webhook, the
-- reconcile cron). Tenants never read it directly.
ALTER TABLE public.phonepe_payment_events ENABLE ROW LEVEL SECURITY;


-- ── 3. confirm_phonepe_payment — the server-side bill finaliser ────
--
-- Called by EITHER the PhonePe webhook OR the every-10-min reconcile
-- cron once a transaction is known to be SUCCESS. Atomically:
--   • locks the order
--   • bails out idempotently if a bill already exists for it
--   • recomputes line tax (CGST + SGST, intra-state — same model as
--     confirm_qr_order_system, the existing QR-ordering path)
--   • honours the order's `service_charge` / `order_discount` / `round_off`
--     so cashier-applied modifiers carry into the auto-confirmed bill
--   • allocates a real invoice number (FY-scoped, per-tenant sequence)
--   • inserts bills + payments(method='PHONEPE') in one transaction
--
-- Why this RPC exists separately from generate_bill:
--   generate_bill is the CASHIER's interactive path — it expects auth.uid()
--   and a hand-built payments array with split methods + references.
--   confirm_phonepe_payment is the SYSTEM path — runs with service-role
--   (no auth.uid), single PHONEPE payment, derives the amount from
--   PhonePe's confirmed transaction. Same end state (a PAID bill), just
--   a different entry point that doesn't depend on a logged-in user.
--
-- IDEMPOTENT: re-calling for an already-billed order returns the
-- existing bill_id + invoice_number without inserting anything new.
-- Webhook + reconcile cron racing each other is therefore safe — only
-- the first call mints a bill.
create or replace function public.confirm_phonepe_payment(
    p_order_id        uuid,
    p_provider_txn_id text,
    p_amount          numeric
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order            public.orders%rowtype;
    v_tenant           public.tenants%rowtype;
    v_bill_id          uuid;
    v_invoice          text;
    v_seq              int;
    v_fy               text;
    v_subtotal         numeric(12,2) := 0;
    v_taxable          numeric(12,2) := 0;
    v_cgst             numeric(12,2) := 0;
    v_sgst             numeric(12,2) := 0;
    v_service_charge   numeric(12,2);
    v_order_discount   numeric(12,2);
    v_round_off        numeric(12,2);
    v_grand            numeric(12,2) := 0;
    v_existing_bill_id uuid;
    v_existing_inv     text;
begin
    -- Lock the order row so a concurrent webhook + cron can't both
    -- create a bill for it.
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then raise exception 'Order % not found', p_order_id; end if;

    -- Idempotency guard — first call wins, all subsequent calls return
    -- whatever bill already exists.
    select id, invoice_number
      into v_existing_bill_id, v_existing_inv
      from public.bills
     where order_id = p_order_id
     limit 1;
    if v_existing_bill_id is not null then
        return json_build_object(
            'ok', true,
            'bill_id', v_existing_bill_id,
            'invoice_number', v_existing_inv,
            'already_confirmed', true
        );
    end if;

    select * into v_tenant from public.tenants where id = v_order.tenant_id;

    -- Recompute per-line tax on order_items (intra-state CGST + SGST).
    -- For inter-state we'd flip to IGST, but the auto-confirm path
    -- assumes intra-state (the cashier flow doesn't expose inter-state
    -- billing in this iteration — match confirm_qr_order_system).
    update public.order_items oi
       set cgst_amount = round(oi.taxable_amount * oi.gst_slab / 200, 2),
           sgst_amount = round(oi.taxable_amount * oi.gst_slab / 200, 2),
           igst_amount = 0,
           line_total  = oi.taxable_amount + 2 * round(oi.taxable_amount * oi.gst_slab / 200, 2)
     where oi.order_id = p_order_id
       and oi.is_void = false;

    select
        coalesce(sum(oi.unit_price * oi.quantity), 0),
        coalesce(sum(oi.taxable_amount), 0),
        coalesce(sum(oi.cgst_amount), 0),
        coalesce(sum(oi.sgst_amount), 0)
      into v_subtotal, v_taxable, v_cgst, v_sgst
      from public.order_items oi
     where oi.order_id = p_order_id
       and oi.is_void = false;

    -- Cashier-applied modifiers — display-checkout stores these on the
    -- order at mint time so they're authoritative here.
    v_service_charge := coalesce(v_order.service_charge, 0);
    v_order_discount := coalesce(v_order.order_discount, 0);
    v_round_off      := coalesce(v_order.round_off, 0);

    v_grand := v_taxable + v_cgst + v_sgst + v_service_charge - v_order_discount + v_round_off;

    -- Allocate invoice + FY label.
    v_seq := public.next_sequence(v_order.tenant_id, 'invoice');
    v_fy  := public.fy_label_of(now(), coalesce(v_tenant.fy_start_month, 4));
    v_invoice := coalesce(v_tenant.invoice_prefix, 'INV') || '-' || v_fy || '-' || lpad(v_seq::text, 5, '0');

    -- Mark the order as PAID + stamp the computed numbers.
    -- billed_by carries the staff attribution from the cashier-side
    -- POS flow (display-checkout writes orders.created_by = the
    -- cashier's auth.uid). For QR-ordering flows, created_by is NULL
    -- (anonymous customer) so billed_by also stays NULL — exactly
    -- what we want: no fake "staff" attached to a self-served sale.
    update public.orders set
        status                = 'PAID',
        awaiting_confirmation = false,
        confirmed_at          = now(),
        billed_at             = now(),
        paid_at               = now(),
        billed_by             = coalesce(billed_by, v_order.created_by),
        subtotal              = v_subtotal,
        taxable_amount        = v_taxable,
        cgst_amount           = v_cgst,
        sgst_amount           = v_sgst,
        grand_total           = v_grand
     where id = p_order_id;

    -- Bill row — branch_id propagates from the order so multi-branch
    -- reporting attributes correctly.
    insert into public.bills (
        tenant_id, order_id, branch_id, invoice_number, fy_label, bill_status,
        subtotal, taxable_amount, cgst_amount, sgst_amount, grand_total,
        service_charge, order_discount, round_off,
        is_inter_state
    ) values (
        v_order.tenant_id, p_order_id, v_order.branch_id, v_invoice, v_fy, 'PAID',
        v_subtotal, v_taxable, v_cgst, v_sgst, v_grand,
        v_service_charge, v_order_discount, v_round_off,
        false
    ) returning id into v_bill_id;

    -- Payment row — method='PHONEPE', reference is PhonePe's own txn id
    -- so a refund / dispute lookup has a one-to-one trail.
    -- received_by attributes the payment to the cashier who initiated
    -- it (v_order.created_by from display-checkout). For QR-ordering
    -- flows the customer placed the order anonymously so this stays
    -- NULL — end-of-shift reports won't (correctly) credit any staff
    -- member for that collection.
    insert into public.payments (
        tenant_id, bill_id, method, amount, reference, received_by, metadata
    ) values (
        v_order.tenant_id, v_bill_id, 'PHONEPE', p_amount,
        p_provider_txn_id,
        v_order.created_by,
        json_build_object('provider', 'phonepe', 'provider_txn_id', p_provider_txn_id)::jsonb
    );

    -- Audit trail — record SYSTEM as the actor (the webhook is the
    -- direct caller, not a logged-in user), but propagate the
    -- cashier's user_id into the row so reports can join back to the
    -- staff member who handled the sale. For QR orders user_id stays
    -- NULL because v_order.created_by is NULL — the audit entry
    -- correctly shows "no staff involved".
    insert into public.bill_audit_log (
        tenant_id, bill_id, order_id, user_id, user_role, action, after_state
    ) values (
        v_order.tenant_id, v_bill_id, p_order_id, v_order.created_by, 'SYSTEM', 'BILL_GENERATED',
        json_build_object(
            'invoice_number', v_invoice,
            'method', 'PHONEPE',
            'provider_txn_id', p_provider_txn_id,
            'billed_by', v_order.created_by
        )::jsonb
    );

    return json_build_object(
        'ok', true,
        'bill_id', v_bill_id,
        'invoice_number', v_invoice,
        'grand_total', v_grand
    );
end;
$$;

revoke execute on function public.confirm_phonepe_payment(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.confirm_phonepe_payment(uuid, text, numeric) to service_role;

COMMENT ON FUNCTION public.confirm_phonepe_payment(uuid, text, numeric) IS
    'Server-side atomic bill finaliser for PhonePe payments. Called by /api/webhooks/phonepe AND /api/payments/phonepe/reconcile when a transaction lands SUCCESS. Idempotent on order_id.';

COMMIT;

-- ── Final sanity check ─────────────────────────────────────────────
SELECT
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'phonepe_payment_events') AS phonepe_table_exists,
    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenant_payment_gateways' AND column_name LIKE 'phonepe_%') AS phonepe_columns_present;
-- Expected: phonepe_table_exists=1, phonepe_columns_present=8
