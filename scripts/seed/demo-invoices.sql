-- =====================================================================
-- Demo invoice seeder for test123@yopmail.com & resto09783@yopmail.com
--
-- WHAT THIS FILE DOES
--   1. Installs a SECURITY DEFINER function `public.seed_demo_invoices(...)`
--      that, for a given tenant + day, generates N synthetic invoices
--      end-to-end (customer + order + order_items + bill + payments).
--   2. Runs that function for an EDITABLE date range covering BOTH demo
--      tenants, identified by the OWNER user's email address.
--
-- HOW TO USE
--   1. Open this file in the Supabase SQL Editor.
--   2. Scroll to "── SECTION 2 ──" at the bottom and edit
--      `v_start_date` / `v_end_date` to the window you want.
--      Several copy-paste examples are provided right above the
--      variables (single day, last N days, custom range).
--   3. Hit "Run". The whole file is safe to re-paste — Section 1's
--      `CREATE OR REPLACE` reinstalls the function cleanly, and the
--      seeder itself is idempotent on (tenant, day, slot) via a
--      deterministic `client_request_id`, so re-running over an
--      already-seeded range produces no duplicates.
--
-- PREREQUISITES
--   • Each tenant must have at least one active branch
--     (`is_main = true` is preferred but not required).
--   • Each tenant must have ≥ 1 active `menu_items` row — the seeder
--     picks line items from this catalog at random and SKIPS the
--     tenant with a clear notice if the catalog is empty.
--
-- PAYMENT MIX
--   Each invoice gets exactly one payment row picked from a 60/30/10
--   split: CASH / UPI / CARD. UPI rows carry a 12-digit fake UTR;
--   CARD rows carry a masked "**** **** **** 1234" tail.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Function — the single source of truth used by both the manual
--    backfill below AND the Vercel cron.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.seed_demo_invoices(
    p_tenant_id    uuid,
    p_day          date,
    p_min_invoices int default 5,
    p_max_invoices int default 15
)
returns table (
    invoices_created int,
    invoices_skipped int,
    note             text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_branch_id     uuid;
    v_owner_id      uuid;
    v_fy_start      int;
    v_fy_label      text;
    v_tax_country   text;
    v_invoice_count int;
    v_created       int := 0;
    v_skipped       int := 0;
    v_slot          int;
    v_request_id    uuid;
    v_when          timestamptz;
    v_order_id      uuid;
    v_bill_id       uuid;
    v_customer_id   uuid;
    v_order_no      text;
    v_invoice_no    text;
    v_order_seq     int;
    v_invoice_seq   int;
    v_subtotal      numeric(12,2);
    v_taxable       numeric(12,2);
    v_cgst          numeric(12,2);
    v_sgst          numeric(12,2);
    v_igst          numeric(12,2);
    v_grand         numeric(12,2);
    v_line_count    int;
    v_method        text;
    v_pay_ref       text;
    v_cust_name     text;
    v_cust_phone    text;
    v_menu_item     record;
    v_qty           numeric(8,3);
    v_unit_price    numeric(10,2);
    v_line_taxable  numeric(10,2);
    v_line_cgst     numeric(10,2);
    v_line_sgst     numeric(10,2);
    v_line_total    numeric(10,2);
    v_menu_count    int;
    -- Curated 80-name + 80-phone pool of Indian customers. The seeder
    -- picks (name, phone) pairs by hashed index per invoice so the
    -- same invoice is always tagged to the same customer, while two
    -- different invoices get two different people.
    v_names text[] := array[
        'Aarav Sharma','Vihaan Patel','Aditya Kumar','Arjun Singh','Sai Reddy',
        'Reyansh Iyer','Krishna Verma','Ishaan Gupta','Shaurya Joshi','Atharv Mehta',
        'Advait Nair','Vivaan Rao','Ayaan Khan','Dhruv Bose','Kabir Malhotra',
        'Aanya Sharma','Saanvi Patel','Aadhya Kumar','Diya Singh','Ananya Reddy',
        'Pari Iyer','Anika Verma','Riya Gupta','Myra Joshi','Sara Mehta',
        'Ira Nair','Aarohi Rao','Avni Khan','Navya Bose','Ishita Malhotra',
        'Karthik Pillai','Rohan Desai','Yash Agarwal','Aditya Bansal','Rahul Chopra',
        'Siddharth Saxena','Anirudh Menon','Pranav Bhatt','Aryan Choudhary','Nikhil Kapoor',
        'Suhana Bansal','Tara Chopra','Mahi Saxena','Riddhi Menon','Pihu Bhatt',
        'Khushi Choudhary','Aaradhya Kapoor','Anvi Pillai','Mira Desai','Kiara Agarwal',
        'Manish Tiwari','Sandeep Mishra','Vikram Yadav','Harsh Pandey','Sagar Trivedi',
        'Ajay Goyal','Rakesh Sinha','Mohit Kulkarni','Deepak Shetty','Amit Banerjee',
        'Pooja Tiwari','Neha Mishra','Sneha Yadav','Komal Pandey','Shruti Trivedi',
        'Megha Goyal','Ritika Sinha','Swati Kulkarni','Divya Shetty','Priya Banerjee',
        'Tarun Bhandari','Anand Krishnan','Varun Chatterjee','Sanjay Dixit','Naveen Rajan',
        'Karan Solanki','Akash Thakur','Tushar Vyas','Gautam Hegde','Bhavik Shah',
        'Nisha Bhandari','Sanya Krishnan','Mansi Chatterjee','Renu Dixit','Asha Rajan'
    ];
    v_phones text[] := array[
        '9810000001','9810000002','9810000003','9810000004','9810000005',
        '9820000006','9820000007','9820000008','9820000009','9820000010',
        '9830000011','9830000012','9830000013','9830000014','9830000015',
        '9840000016','9840000017','9840000018','9840000019','9840000020',
        '9850000021','9850000022','9850000023','9850000024','9850000025',
        '9860000026','9860000027','9860000028','9860000029','9860000030',
        '9870000031','9870000032','9870000033','9870000034','9870000035',
        '9880000036','9880000037','9880000038','9880000039','9880000040',
        '9890000041','9890000042','9890000043','9890000044','9890000045',
        '9911000046','9911000047','9911000048','9911000049','9911000050',
        '9912000051','9912000052','9912000053','9912000054','9912000055',
        '9913000056','9913000057','9913000058','9913000059','9913000060',
        '9914000061','9914000062','9914000063','9914000064','9914000065',
        '9915000066','9915000067','9915000068','9915000069','9915000070',
        '9916000071','9916000072','9916000073','9916000074','9916000075',
        '9917000076','9917000077','9917000078','9917000079','9917000080'
    ];
    v_name_pool_size int := array_length(v_names, 1);
    v_phone_pool_size int := array_length(v_phones, 1);
    v_cust_idx int;
begin
    if p_tenant_id is null then
        return query select 0, 0, 'tenant_id is null'::text;
        return;
    end if;

    -- Pick a branch — main first, else any.
    select id into v_branch_id
    from public.branches
    where tenant_id = p_tenant_id and is_active = true
    order by is_main desc nulls last, created_at asc
    limit 1;
    if v_branch_id is null then
        return query select 0, 0, 'no active branch for this tenant'::text;
        return;
    end if;

    -- Pick the OWNER (or first user) for created_by / billed_by snapshots.
    select id into v_owner_id
    from public.users
    where tenant_id = p_tenant_id
    order by case when role = 'OWNER' then 0 else 1 end, created_at asc
    limit 1;
    -- Tolerate no-user (very rare for live tenants) — we'll just leave
    -- the FKs null, which the schema allows.

    -- Tax setup (FY label + country flag for GST split vs. single line).
    select fy_start_month, country into v_fy_start, v_tax_country
    from public.tenants where id = p_tenant_id;
    v_fy_start := coalesce(v_fy_start, 4);
    v_fy_label := public.fy_label_of(p_day::timestamptz, v_fy_start);

    -- Catalog sanity — without items we can't build invoices.
    select count(*) into v_menu_count
    from public.menu_items
    where tenant_id = p_tenant_id
      and is_active = true
      and deleted_at is null;
    if v_menu_count = 0 then
        return query select 0, 0, 'no active menu_items — seed the menu first'::text;
        return;
    end if;

    -- Decide today's invoice count deterministically per (tenant, day).
    -- Hash → integer in [p_min, p_max]. Same day → same count, so the
    -- seeder is replayable without surprises.
    v_invoice_count := p_min_invoices + (
        abs(hashtext(p_tenant_id::text || p_day::text)) %
        greatest(p_max_invoices - p_min_invoices + 1, 1)
    );

    for v_slot in 1..v_invoice_count loop
        -- Deterministic request id → idempotency for this exact slot.
        v_request_id := md5(
            p_tenant_id::text || '|' || p_day::text || '|' || v_slot::text
        )::uuid;

        -- Already seeded? Skip silently.
        if exists (
            select 1 from public.bills
            where tenant_id = p_tenant_id and client_request_id = v_request_id
        ) then
            v_skipped := v_skipped + 1;
            continue;
        end if;

        -- Spread the timestamps across business hours (11 AM → 10:59 PM).
        v_when := (p_day::timestamp + interval '11 hours'
                   + (v_slot * interval '45 minutes')
                   + ((abs(hashtext(v_request_id::text)) % 1800) * interval '1 second'))
                  at time zone 'Asia/Kolkata' at time zone 'UTC';

        -- Customer pick — same slot always ties to the same person.
        v_cust_idx := (abs(hashtext(v_request_id::text)) % v_name_pool_size);
        v_cust_name := v_names[v_cust_idx + 1];
        v_cust_phone := v_phones[(abs(hashtext(v_request_id::text || 'p')) % v_phone_pool_size) + 1];

        -- Upsert the customer by (tenant_id, phone).
        insert into public.customers (tenant_id, name, phone)
        values (p_tenant_id, v_cust_name, v_cust_phone)
        on conflict (tenant_id, phone) do update
            set name = coalesce(public.customers.name, excluded.name)
        returning id into v_customer_id;

        -- Number generation.
        v_order_seq := public.next_sequence(p_tenant_id, 'order');
        v_invoice_seq := public.next_sequence(p_tenant_id, 'invoice');
        v_order_no   := 'ORD-' || v_fy_label || '-' || lpad(v_order_seq::text, 5, '0');
        v_invoice_no := 'INV-' || v_fy_label || '-' || lpad(v_invoice_seq::text, 5, '0');

        -- 1..6 random line items.
        v_line_count := 1 + (abs(hashtext(v_request_id::text || 'lc')) % 6);

        -- Create the order shell. We'll fill amounts after the lines.
        insert into public.orders (
            tenant_id, branch_id, order_number, status, order_type,
            customer_id, created_by, billed_by,
            created_at, updated_at, billed_at, paid_at
        ) values (
            p_tenant_id, v_branch_id, v_order_no, 'PAID', 'TAKEAWAY',
            v_customer_id, v_owner_id, v_owner_id,
            v_when, v_when, v_when, v_when
        ) returning id into v_order_id;

        -- Insert N random line items + accumulate totals.
        v_subtotal := 0; v_taxable := 0; v_cgst := 0; v_sgst := 0; v_igst := 0;
        for i in 1..v_line_count loop
            -- Pick a random menu item. Using ORDER BY random() LIMIT 1
            -- works for small N — these tenants will have menus
            -- well under 10k rows so the planner is fine.
            select id, name, base_price, sale_price, gst_slab, hsn_code
              into v_menu_item
              from public.menu_items
              where tenant_id = p_tenant_id
                and is_active = true
                and deleted_at is null
              order by random()
              limit 1;

            v_qty := 1 + (abs(hashtext(v_request_id::text || i::text)) % 4);
            v_unit_price := coalesce(v_menu_item.sale_price, v_menu_item.base_price);

            v_line_taxable := round(v_unit_price * v_qty, 2);
            -- Split GST 50/50 between CGST + SGST (intra-state) for the
            -- common Indian case. IGST stays 0. Outside India the
            -- gst_slab is 0 in most catalogs so this becomes a no-op.
            v_line_cgst := round(v_line_taxable * (v_menu_item.gst_slab / 2) / 100, 2);
            v_line_sgst := v_line_cgst;
            v_line_total := v_line_taxable + v_line_cgst + v_line_sgst;

            insert into public.order_items (
                tenant_id, order_id, menu_item_id, item_name, hsn_code, gst_slab,
                quantity, unit_price, taxable_amount,
                cgst_amount, sgst_amount, igst_amount, line_total,
                kds_status, created_at, updated_at
            ) values (
                p_tenant_id, v_order_id, v_menu_item.id, v_menu_item.name,
                v_menu_item.hsn_code, v_menu_item.gst_slab,
                v_qty, v_unit_price, v_line_taxable,
                v_line_cgst, v_line_sgst, 0, v_line_total,
                'SERVED', v_when, v_when
            );

            v_subtotal := v_subtotal + v_line_taxable;
            v_taxable  := v_taxable  + v_line_taxable;
            v_cgst     := v_cgst     + v_line_cgst;
            v_sgst     := v_sgst     + v_line_sgst;
        end loop;

        v_grand := v_taxable + v_cgst + v_sgst + v_igst;

        -- Roll the totals onto the order.
        update public.orders set
            subtotal       = v_subtotal,
            taxable_amount = v_taxable,
            cgst_amount    = v_cgst,
            sgst_amount    = v_sgst,
            igst_amount    = v_igst,
            grand_total    = v_grand
        where id = v_order_id;

        -- Insert the bill (the locked invoice).
        insert into public.bills (
            tenant_id, branch_id, order_id, invoice_number, fy_label,
            bill_status, subtotal, taxable_amount,
            cgst_amount, sgst_amount, igst_amount, grand_total,
            customer_name, customer_phone,
            client_request_id, created_at, updated_at, locked_at
        ) values (
            p_tenant_id, v_branch_id, v_order_id, v_invoice_no, v_fy_label,
            'PAID', v_subtotal, v_taxable,
            v_cgst, v_sgst, v_igst, v_grand,
            v_cust_name, v_cust_phone,
            v_request_id, v_when, v_when, v_when
        ) returning id into v_bill_id;

        -- Payment — single row, method picked from 60 / 30 / 10 split.
        v_method := case
            when (abs(hashtext(v_request_id::text || 'pm')) % 10) < 6 then 'CASH'
            when (abs(hashtext(v_request_id::text || 'pm')) % 10) < 9 then 'UPI'
            else 'CARD'
        end;
        v_pay_ref := case v_method
            when 'CASH' then null
            when 'UPI'  then lpad(
                (abs(hashtext(v_request_id::text || 'utr')) % 1000000000000)::text, 12, '0'
            )
            when 'CARD' then '**** **** **** ' || lpad(
                (abs(hashtext(v_request_id::text || 'card')) % 10000)::text, 4, '0'
            )
        end;

        insert into public.payments (
            tenant_id, bill_id, method, amount, reference,
            received_by, created_at
        ) values (
            p_tenant_id, v_bill_id, v_method, v_grand, v_pay_ref,
            v_owner_id, v_when
        );

        v_created := v_created + 1;
    end loop;

    return query select v_created, v_skipped, ('ok — branch ' || v_branch_id::text)::text;
end;
$$;

revoke all on function public.seed_demo_invoices(uuid, date, int, int) from public, anon;
grant execute on function public.seed_demo_invoices(uuid, date, int, int) to service_role;


-- ─────────────────────────────────────────────────────────────────────
-- ── SECTION 2 ── RUNNER — edit the two dates below and hit Run.
--
-- The block calls `public.seed_demo_invoices()` once per (tenant, day)
-- across the inclusive window [v_start_date, v_end_date] for BOTH
-- demo tenants (looked up by the OWNER user's email so you don't have
-- to hard-code tenant UUIDs).
--
-- ┌──────────────────────────────────────────────────────────────────┐
-- │ EDIT THESE TWO LINES — pick any of the patterns below            │
-- ├──────────────────────────────────────────────────────────────────┤
-- │ -- Single day  → set both to the same date:                      │
-- │   v_start_date date := '2026-04-15';                             │
-- │   v_end_date   date := '2026-04-15';                             │
-- │                                                                  │
-- │ -- Today only:                                                   │
-- │   v_start_date date := current_date;                             │
-- │   v_end_date   date := current_date;                             │
-- │                                                                  │
-- │ -- Last N days (e.g. 30):                                        │
-- │   v_start_date date := current_date - 30;                        │
-- │   v_end_date   date := current_date;                             │
-- │                                                                  │
-- │ -- Custom range (e.g. April 2026):                               │
-- │   v_start_date date := '2026-04-01';                             │
-- │   v_end_date   date := '2026-04-30';                             │
-- └──────────────────────────────────────────────────────────────────┘
--
-- Optional knobs (commented out by default — see usage at bottom):
--   • p_min_invoices / p_max_invoices on `seed_demo_invoices()` set
--     the daily count range (defaults 5 / 15). Pass them explicitly
--     if you want a busier or quieter day.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
    -- ✏️  EDIT THESE TWO LINES ──────────────────────────────────────
    v_start_date date := current_date - 60;   -- inclusive
    v_end_date   date := current_date;        -- inclusive
    -- ─────────────────────────────────────────────────────────────

    v_emails text[] := array['test123@yopmail.com', 'resto09783@yopmail.com'];
    v_email  text;
    v_tenant uuid;
    v_day    date;
    v_total_created int := 0;
    v_total_skipped int := 0;
    v_row_created int;
    v_row_skipped int;
    v_row_note    text;
begin
    if v_start_date > v_end_date then
        raise exception 'v_start_date (%) is after v_end_date (%) — swap them or set them equal for a single day',
            v_start_date, v_end_date;
    end if;

    raise notice '════════════════════════════════════════';
    raise notice 'Seeding range: %  →  %  (% day(s))',
        v_start_date, v_end_date, (v_end_date - v_start_date + 1);
    raise notice '════════════════════════════════════════';

    foreach v_email in array v_emails loop
        -- Look up the tenant for this email. We pick the OWNER row first
        -- so a tenant with multiple staff still resolves cleanly.
        select tenant_id into v_tenant
        from public.users
        where email = v_email
          and tenant_id is not null
        order by case when role = 'OWNER' then 0 else 1 end, created_at asc
        limit 1;

        if v_tenant is null then
            raise notice 'SKIPPED: no tenant found for email %', v_email;
            continue;
        end if;

        raise notice 'Seeding tenant % (email %) …', v_tenant, v_email;

        for v_day in
            select gs::date
            from generate_series(v_start_date, v_end_date, interval '1 day') as gs
        loop
            select s.invoices_created, s.invoices_skipped, s.note
              into v_row_created, v_row_skipped, v_row_note
              from public.seed_demo_invoices(v_tenant, v_day) s;

            v_total_created := v_total_created + v_row_created;
            v_total_skipped := v_total_skipped + v_row_skipped;
        end loop;

        raise notice '  → done with %', v_email;
    end loop;

    raise notice '════════════════════════════════════════';
    raise notice 'Seed complete: % invoices created, % skipped (idempotency hits).',
        v_total_created, v_total_skipped;
end$$;


-- ─────────────────────────────────────────────────────────────────────
-- BONUS: one-off direct calls (for ad-hoc tinkering — uncomment and run)
-- ─────────────────────────────────────────────────────────────────────
--
-- A) Seed a single day for ONE tenant (by email), busier than default:
--
-- select s.*
-- from public.seed_demo_invoices(
--     p_tenant_id    := (
--         select tenant_id from public.users
--         where email = 'test123@yopmail.com' and tenant_id is not null
--         order by case when role = 'OWNER' then 0 else 1 end, created_at asc
--         limit 1
--     ),
--     p_day          := '2026-04-15'::date,
--     p_min_invoices := 20,
--     p_max_invoices := 40
-- ) s;
--
-- B) Wipe a previously-seeded day (only the demo rows — others untouched):
--
-- delete from public.bills
-- where client_request_id is not null
--   and created_at::date = '2026-04-15'
--   and tenant_id in (
--       select tenant_id from public.users
--       where email in ('test123@yopmail.com', 'resto09783@yopmail.com')
--   );
