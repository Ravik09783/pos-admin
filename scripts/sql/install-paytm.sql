-- =============================================================================
-- install-paytm.sql — one-shot Paytm installer for a live database
-- =============================================================================
-- Run this ONCE in the Supabase SQL editor on a database where the Paytm
-- objects are missing (they were removed by scripts/sql/drop-paytm.sql, or the
-- DB never had bundles 33 + 54 applied).
--
-- It contains ONLY the missing Paytm pieces, in a safe order:
--   1. Paytm credential columns on tenant_payment_gateways (prod + staging
--      pairs, enabled flag, env toggle) + webhook lookup index.
--   2. paytm_payment_events — the per-transaction tracking table the webhook
--      and reconcile cron key on.
--   3. payments.method check — re-pointed to the full current list (adds
--      PAYTM back, keeps GIFT_CARD/LOYALTY).
--   4. confirm_qr_order_system / confirm_display_checkout_payment re-created
--      WITH the p_method parameter the Paytm + Stripe webhooks pass.
--
-- It deliberately does NOT touch tenants.payment_gateway's check constraint —
-- migration 58 already set that to ('manual','phonepe','paytm','stripe').
--
-- IDEMPOTENT — safe to re-run.
-- =============================================================================

-- ── 1. Per-tenant Paytm credentials ─────────────────────────────────────────
alter table public.tenant_payment_gateways
    add column if not exists paytm_mid                  text,
    add column if not exists paytm_merchant_key         text,
    add column if not exists paytm_mid_staging          text,
    add column if not exists paytm_merchant_key_staging text,
    add column if not exists paytm_enabled              boolean not null default false,
    add column if not exists paytm_env                  text not null default 'staging';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'tpg_paytm_env_check'
          and conrelid = 'public.tenant_payment_gateways'::regclass
    ) then
        alter table public.tenant_payment_gateways
            add constraint tpg_paytm_env_check
            check (paytm_env in ('staging', 'production'));
    end if;
end $$;

comment on column public.tenant_payment_gateways.paytm_mid is
    'Paytm Merchant ID (MID) for the PRODUCTION environment. The test pair lives in paytm_mid_staging; paytm_env picks the active pair.';
comment on column public.tenant_payment_gateways.paytm_merchant_key is
    'Paytm Merchant Key (secret) for PRODUCTION — used to sign every API call and verify webhook CHECKSUMHASH. OWNER-only via RLS.';

create index if not exists idx_tpg_paytm_mid
    on public.tenant_payment_gateways (paytm_mid)
    where paytm_mid is not null;

-- ── 2. paytm_payment_events — one row per dynamic QR issued ─────────────────
create table if not exists public.paytm_payment_events (
    paytm_order_id      text primary key,
    tenant_id           uuid not null references public.tenants(id) on delete cascade,
    order_id            uuid references public.orders(id) on delete set null,
    display_session_id  uuid,
    bill_id             uuid references public.bills(id) on delete set null,
    amount              numeric(12,2) not null,
    currency            text not null default 'INR',
    flow                text not null default 'POS'
                        check (flow in ('POS', 'QR_ORDER')),
    status              text not null default 'PENDING'
                        check (status in ('PENDING', 'SUCCESS', 'FAILED')),
    paytm_txn_id        text,
    raw                 jsonb,
    created_at          timestamptz default now(),
    processed_at        timestamptz
);

create index if not exists idx_paytm_events_tenant_status
    on public.paytm_payment_events (tenant_id, status, created_at desc);

-- RLS on, NO policies — service-role only (webhook + reconcile cron).
alter table public.paytm_payment_events enable row level security;

-- ── 3. payments.method — allow PAYTM again (full current list) ──────────────
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
    check (method in (
        'CASH','UPI','CARD','RAZORPAY','PHONEPE','PAYTM','STRIPE',
        'BANK_TRANSFER','CREDIT','COMPLIMENTARY','OTHER',
        'GIFT_CARD','LOYALTY'
    ));

-- ── 4. Confirm RPCs with p_method ────────────────────────────────────────────
-- The webhook needs to record the REAL gateway on payments.method. Old
-- signatures (without p_method) are dropped so PostgREST never sees an
-- ambiguous overload; defaults keep the Stripe webhook's existing calls valid.

drop function if exists public.confirm_display_checkout_payment(
    uuid, uuid, text, numeric, numeric, text);

create or replace function public.confirm_display_checkout_payment(
    p_order_id           uuid,
    p_display_session_id uuid,
    p_stripe_intent_id   text,
    p_gross_amount       numeric,
    p_platform_fee       numeric default 0,
    p_currency           text    default 'usd',
    p_method             text    default 'STRIPE'
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order         public.orders%rowtype;
    v_tenant        public.tenants%rowtype;
    v_bill_id       uuid;
    v_invoice       text;
    v_seq           int;
    v_fy            text;
    v_subtotal      numeric(12,2) := 0;
    v_taxable       numeric(12,2) := 0;
    v_cgst          numeric(12,2) := 0;
    v_sgst          numeric(12,2) := 0;
    v_grand         numeric(12,2) := 0;
    v_existing_bill uuid;
    v_transferred   numeric(12,2);
    v_paid          numeric(12,2) := coalesce(p_gross_amount, 0);
    v_method        text := coalesce(nullif(p_method, ''), 'STRIPE');
    v_amount_ok     boolean;
begin
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then raise exception 'order_not_found'; end if;

    select id into v_existing_bill from public.bills where order_id = p_order_id limit 1;
    if v_existing_bill is not null then
        update public.pos_display_sessions
        set status = 'PAID',
            invoice_number = (select invoice_number from public.bills where id = v_existing_bill)
        where id = p_display_session_id;
        return json_build_object('ok', true, 'bill_id', v_existing_bill, 'already_confirmed', true);
    end if;

    select * into v_tenant from public.tenants where id = v_order.tenant_id;

    update public.order_items oi
    set cgst_amount = round(oi.taxable_amount * oi.gst_slab / 200, 2),
        sgst_amount = round(oi.taxable_amount * oi.gst_slab / 200, 2),
        igst_amount = 0,
        line_total  = oi.taxable_amount + 2 * round(oi.taxable_amount * oi.gst_slab / 200, 2)
    where oi.order_id = p_order_id and oi.is_void = false;

    select
        coalesce(sum(oi.unit_price * oi.quantity), 0),
        coalesce(sum(oi.taxable_amount), 0),
        coalesce(sum(oi.cgst_amount), 0),
        coalesce(sum(oi.sgst_amount), 0)
    into v_subtotal, v_taxable, v_cgst, v_sgst
    from public.order_items oi
    where oi.order_id = p_order_id and oi.is_void = false;

    v_grand := v_taxable + v_cgst + v_sgst;
    v_amount_ok := (v_paid <= 0) or (abs(v_grand - v_paid) <= 1.00);

    v_seq := public.next_sequence(v_order.tenant_id, 'invoice');
    v_fy  := public.fy_label_of(now(), coalesce(v_tenant.fy_start_month, 4));
    v_invoice := coalesce(v_tenant.invoice_prefix, 'INV') || '-' || v_fy || '-' || lpad(v_seq::text, 5, '0');

    update public.orders set
        status = 'PAID',
        billed_at = now(),
        paid_at = now(),
        subtotal = v_subtotal,
        taxable_amount = v_taxable,
        cgst_amount = v_cgst,
        sgst_amount = v_sgst,
        grand_total = v_grand
    where id = p_order_id;

    insert into public.bills (
        tenant_id, order_id, invoice_number, fy_label, bill_status,
        subtotal, taxable_amount, cgst_amount, sgst_amount, grand_total,
        is_inter_state, branch_id
    ) values (
        v_order.tenant_id, p_order_id, v_invoice, v_fy, 'PAID',
        v_subtotal, v_taxable, v_cgst, v_sgst, v_grand,
        false, v_order.branch_id
    ) returning id into v_bill_id;

    v_transferred := greatest(0::numeric, coalesce(p_gross_amount, 0) - coalesce(p_platform_fee, 0));

    insert into public.payments (
        tenant_id, bill_id, method, amount, reference,
        gross_amount, platform_fee, transferred_amount,
        stripe_payment_intent_id, metadata
    ) values (
        v_order.tenant_id, v_bill_id, v_method,
        v_transferred,
        p_stripe_intent_id,
        coalesce(p_gross_amount, 0),
        coalesce(p_platform_fee, 0),
        v_transferred,
        p_stripe_intent_id,
        json_build_object('source', 'CASHIER_DISPLAY', 'gateway', v_method, 'currency', p_currency)::jsonb
    );

    insert into public.bill_audit_log (
        tenant_id, bill_id, order_id, user_role, action, after_state
    ) values (
        v_order.tenant_id, v_bill_id, p_order_id, 'SYSTEM', 'BILL_GENERATED',
        json_build_object(
            'invoice_number', v_invoice,
            'grand_total', v_grand,
            'paid_amount', v_paid,
            'amount_ok', v_amount_ok,
            'source', 'CASHIER_DISPLAY_' || v_method,
            'payment_reference', p_stripe_intent_id
        )::jsonb
    );

    if not v_amount_ok then
        raise notice 'confirm_display_checkout_payment: amount mismatch bill=% grand=% paid=%',
            v_bill_id, v_grand, v_paid;
    end if;

    update public.pos_display_sessions
    set status = 'PAID',
        invoice_number = v_invoice
    where id = p_display_session_id;

    begin
        perform public.update_customer_on_payment(v_bill_id);
    exception when others then
        raise notice 'update_customer_on_payment failed: %', sqlerrm;
    end;

    return json_build_object(
        'ok', true,
        'bill_id', v_bill_id,
        'invoice_number', v_invoice,
        'grand_total', v_grand,
        'amount_ok', v_amount_ok
    );
end;
$$;

revoke execute on function public.confirm_display_checkout_payment(uuid, uuid, text, numeric, numeric, text, text)
    from public, anon, authenticated;
grant execute on function public.confirm_display_checkout_payment(uuid, uuid, text, numeric, numeric, text, text)
    to service_role;

drop function if exists public.confirm_qr_order_system(uuid, text, numeric);

create or replace function public.confirm_qr_order_system(
    p_order_id            uuid,
    p_razorpay_payment_id text,
    p_amount              numeric,
    p_method              text default 'STRIPE'
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order    public.orders%rowtype;
    v_tenant   public.tenants%rowtype;
    v_bill_id  uuid;
    v_invoice  text;
    v_seq      int;
    v_fy       text;
    v_subtotal numeric(12,2) := 0;
    v_taxable  numeric(12,2) := 0;
    v_cgst     numeric(12,2) := 0;
    v_sgst     numeric(12,2) := 0;
    v_grand    numeric(12,2) := 0;
    v_existing_bill uuid;
    v_method   text := coalesce(nullif(p_method, ''), 'STRIPE');
    v_paid     numeric(12,2) := coalesce(p_amount, 0);
    v_amount_ok boolean;
begin
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then raise exception 'Order not found'; end if;

    select id into v_existing_bill from public.bills where order_id = p_order_id limit 1;
    if v_existing_bill is not null then
        return json_build_object('ok', true, 'bill_id', v_existing_bill, 'already_confirmed', true);
    end if;

    select * into v_tenant from public.tenants where id = v_order.tenant_id;

    update public.order_items oi
    set
        cgst_amount = round(oi.taxable_amount * oi.gst_slab / 200, 2),
        sgst_amount = round(oi.taxable_amount * oi.gst_slab / 200, 2),
        igst_amount = 0,
        line_total  = oi.taxable_amount + 2 * round(oi.taxable_amount * oi.gst_slab / 200, 2)
    where oi.order_id = p_order_id and oi.is_void = false;

    select
        coalesce(sum(oi.unit_price * oi.quantity), 0),
        coalesce(sum(oi.taxable_amount), 0),
        coalesce(sum(oi.cgst_amount), 0),
        coalesce(sum(oi.sgst_amount), 0)
    into v_subtotal, v_taxable, v_cgst, v_sgst
    from public.order_items oi
    where oi.order_id = p_order_id and oi.is_void = false;

    v_grand := v_taxable + v_cgst + v_sgst;
    v_amount_ok := (v_paid <= 0) or (abs(v_grand - v_paid) <= 1.00);

    v_seq := public.next_sequence(v_order.tenant_id, 'invoice');
    v_fy := public.fy_label_of(now(), coalesce(v_tenant.fy_start_month, 4));
    v_invoice := coalesce(v_tenant.invoice_prefix, 'INV') || '-' || v_fy || '-' || lpad(v_seq::text, 5, '0');

    update public.orders set
        status = 'PAID',
        awaiting_confirmation = false,
        confirmed_at = now(),
        billed_at = now(),
        paid_at = now(),
        subtotal = v_subtotal,
        taxable_amount = v_taxable,
        cgst_amount = v_cgst,
        sgst_amount = v_sgst,
        grand_total = v_grand,
        razorpay_payment_id = p_razorpay_payment_id
    where id = p_order_id;

    insert into public.bills (
        tenant_id, order_id, branch_id, invoice_number, fy_label, bill_status,
        subtotal, taxable_amount, cgst_amount, sgst_amount, grand_total,
        is_inter_state
    ) values (
        v_order.tenant_id, p_order_id, v_order.branch_id, v_invoice, v_fy, 'PAID',
        v_subtotal, v_taxable, v_cgst, v_sgst, v_grand,
        false
    ) returning id into v_bill_id;

    insert into public.payments (tenant_id, bill_id, method, amount, reference, metadata)
    values (
        v_order.tenant_id, v_bill_id, v_method, p_amount,
        p_razorpay_payment_id,
        json_build_object('gateway', v_method, 'gateway_ref', p_razorpay_payment_id)::jsonb
    );

    insert into public.bill_audit_log (
        tenant_id, bill_id, order_id, user_id, user_role, action, after_state
    ) values (
        v_order.tenant_id, v_bill_id, p_order_id, null, 'SYSTEM', 'BILL_GENERATED',
        json_build_object(
            'source', 'qr_confirm',
            'gateway', v_method,
            'invoice_number', v_invoice,
            'grand_total', v_grand,
            'paid_amount', v_paid,
            'amount_ok', v_amount_ok,
            'branch_id', v_order.branch_id
        )::jsonb
    );

    if not v_amount_ok then
        raise notice 'confirm_qr_order_system: amount mismatch bill=% grand=% paid=%',
            v_bill_id, v_grand, v_paid;
    end if;

    return json_build_object('ok', true, 'bill_id', v_bill_id, 'invoice_number', v_invoice,
                             'amount_ok', v_amount_ok);
end;
$$;

revoke execute on function public.confirm_qr_order_system(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.confirm_qr_order_system(uuid, text, numeric, text) to service_role;

notify pgrst, 'reload schema';
