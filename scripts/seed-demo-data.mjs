#!/usr/bin/env node
/**
 * Demo-data seeder — backfills a tenant with realistic history:
 *
 *   • last 5 months of INVOICES (orders + order_items + bills + payments,
 *     correct GST split, FY-correct invoice numbers continuing the tenant's
 *     real sequence)
 *   • ≥20 EMPLOYEES with last 5 months of ATTENDANCE (presents/halves/
 *     leaves/absents/weekly-offs, check-in/out times, worked minutes)
 *
 * USAGE
 *   node scripts/seed-demo-data.mjs <owner-email>             # seed
 *   node scripts/seed-demo-data.mjs <owner-email> --dry-run   # plan only
 *   node scripts/seed-demo-data.mjs <owner-email> --cleanup   # remove seeded data
 *
 * Options:
 *   --employees N        how many employees to ensure exist (default 22)
 *   --bills-min N        min bills per day (default 3)
 *   --bills-max N        max bills per day (default 8)
 *   --months N           how many months back (default 5)
 *
 * The email picks the tenant: it must be a user (typically the OWNER) of the
 * restaurant you want to seed. Credentials come from .env
 * (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 *
 * Everything seeded is tagged so --cleanup can remove it surgically:
 *   orders.order_number LIKE 'SD-%' · hr_attendance.notes = 'seed'
 *   hr_employees.email LIKE '%@seed.local'
 *
 * NOTE on invoice numbers: bills are backdated, so the script computes each
 * bill's own financial-year label (the SQL next_sequence() would stamp
 * today's FY) and advances tenant_sequences per FY itself. Run it while the
 * restaurant is idle — it reads the counters once, allocates serially, and
 * writes the final values back at the end.
 */

import fs from "node:fs"
import crypto from "node:crypto"

// ── env ──────────────────────────────────────────────────────────────────
const env = {}
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) { console.error("✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env"); process.exit(1) }

// ── args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const email = args.find((a) => !a.startsWith("--"))
if (!email) { console.error("Usage: node scripts/seed-demo-data.mjs <owner-email> [--dry-run|--cleanup] [--employees 22] [--months 5]"); process.exit(1) }
const flag = (n) => args.includes(`--${n}`)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d }
const DRY = flag("dry-run")
const CLEANUP = flag("cleanup")
const N_EMP = Math.max(20, opt("employees", 22))
const BILLS_MIN = opt("bills-min", 3)
const BILLS_MAX = opt("bills-max", 8)
const MONTHS = opt("months", 5)

// ── tiny REST helpers (service role — bypasses RLS) ──────────────────────
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }
async function get(path) {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H })
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return r.json()
}
async function insert(table, rows, { returning = false } = {}) {
    const r = await fetch(`${URL_}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...H, Prefer: returning ? "return=representation" : "return=minimal" },
        body: JSON.stringify(rows),
    })
    if (!r.ok) throw new Error(`INSERT ${table} → ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return returning ? r.json() : null
}
async function upsert(table, rows, onConflict) {
    const r = await fetch(`${URL_}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: "POST",
        headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
    })
    if (!r.ok) throw new Error(`UPSERT ${table} → ${r.status}: ${(await r.text()).slice(0, 300)}`)
}
async function del(table, filter) {
    const r = await fetch(`${URL_}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } })
    if (!r.ok) throw new Error(`DELETE ${table}?${filter} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
}
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
const rand = (a, b) => a + Math.random() * (b - a)
const randInt = (a, b) => Math.floor(rand(a, b + 1))
const pick = (arr) => arr[randInt(0, arr.length - 1)]
const r2 = (v) => Math.round(v * 100) / 100
const pad = (n, w = 2) => String(n).padStart(w, "0")

// FY label, replicating public.fy_label_of (e.g. "2026-27").
function fyLabel(d, fyStart) {
    const y = d.getFullYear()
    return (d.getMonth() + 1) >= fyStart
        ? `${y}-${String((y + 1) % 100).padStart(2, "0")}`
        : `${y - 1}-${String(y % 100).padStart(2, "0")}`
}

// ── name pools for employees ─────────────────────────────────────────────
const FIRST = ["Aarav", "Vivaan", "Aditya", "Karan", "Rohan", "Arjun", "Sai", "Krishna", "Ishaan", "Kabir", "Ananya", "Diya", "Priya", "Sneha", "Pooja", "Neha", "Riya", "Kavya", "Meera", "Anjali", "Rahul", "Vikram", "Suresh", "Ramesh", "Deepak", "Manoj"]
const LAST = ["Sharma", "Verma", "Singh", "Kumar", "Gupta", "Patel", "Reddy", "Nair", "Mehta", "Joshi", "Yadav", "Das", "Roy", "Mishra", "Chauhan"]
const ROLES = [
    ["Head Chef", "Kitchen", "MONTHLY", [25000, 40000]],
    ["Chef", "Kitchen", "MONTHLY", [16000, 25000]],
    ["Kitchen Helper", "Kitchen", "DAILY", [500, 750]],
    ["Waiter", "Service", "MONTHLY", [12000, 18000]],
    ["Captain", "Service", "MONTHLY", [15000, 22000]],
    ["Cashier", "Front Desk", "MONTHLY", [14000, 20000]],
    ["Cleaner", "Housekeeping", "DAILY", [400, 600]],
    ["Delivery Boy", "Delivery", "DAILY", [500, 800]],
]
const FALLBACK_MENU = [
    ["Paneer Butter Masala", 280, 5], ["Dal Makhani", 240, 5], ["Veg Biryani", 260, 5],
    ["Chicken Biryani", 320, 5], ["Butter Naan", 60, 5], ["Tandoori Roti", 30, 5],
    ["Masala Dosa", 150, 5], ["Chole Bhature", 160, 5], ["Gulab Jamun", 90, 5],
    ["Cold Coffee", 120, 12], ["Masala Chai", 40, 5], ["Fresh Lime Soda", 80, 12],
]

;(async () => {
    // ── resolve user → tenant ───────────────────────────────────────────
    const users = await get(`users?select=id,tenant_id,full_name&email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`)
    if (!users[0]?.tenant_id) { console.error(`✗ No user with email ${email} (or no tenant attached).`); process.exit(1) }
    const ownerId = users[0].id
    const tenantId = users[0].tenant_id
    const [tenant] = await get(`tenants?select=name,fy_start_month,invoice_prefix,currency&id=eq.${tenantId}`)
    const fyStart = tenant.fy_start_month ?? 4
    const prefix = tenant.invoice_prefix || "INV"
    const branches = await get(`branches?select=id,name,is_main&tenant_id=eq.${tenantId}&order=is_main.desc&limit=1`)
    const branchId = branches[0]?.id ?? null
    console.log(`Tenant: ${tenant.name} · branch: ${branches[0]?.name ?? "(none)"} · prefix: ${prefix} · FY starts month ${fyStart}`)

    // ── cleanup mode ────────────────────────────────────────────────────
    if (CLEANUP) {
        console.log("Cleaning seeded data…")
        const orders = await get(`orders?select=id&tenant_id=eq.${tenantId}&order_number=like.SD-*&limit=10000`)
        const oids = orders.map((o) => o.id)
        console.log(`  seeded orders: ${oids.length}`)
        for (const ids of chunk(oids, 80)) {
            const list = `(${ids.join(",")})`
            const bills = await get(`bills?select=id&order_id=in.${list}`)
            const bids = bills.map((b) => b.id)
            if (bids.length) {
                await del("payments", `bill_id=in.(${bids.join(",")})`)
                await del("bill_audit_log", `bill_id=in.(${bids.join(",")})`)
                await del("bills", `id=in.(${bids.join(",")})`)
            }
            await del("order_items", `order_id=in.${list}`)
            await del("orders", `id=in.${list}`)
        }
        await del("hr_attendance", `tenant_id=eq.${tenantId}&notes=eq.seed`)
        const emps = await get(`hr_employees?select=id&tenant_id=eq.${tenantId}&email=like.*@seed.local`)
        if (emps.length) {
            const ids = `(${emps.map((e) => e.id).join(",")})`
            await del("hr_attendance", `employee_id=in.${ids}`)
            await del("hr_attendance_audit", `employee_id=in.${ids}`)
            await del("hr_employees", `id=in.${ids}`)
        }
        console.log("✓ cleanup done")
        return
    }

    // ── date range: 1st of (now - MONTHS+1) … yesterday ─────────────────
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1), 1)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const days = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d))
    console.log(`Range: ${days[0].toDateString()} → ${days[days.length - 1].toDateString()} (${days.length} days)`)

    // ── employees ───────────────────────────────────────────────────────
    const existing = await get(`hr_employees?select=id,full_name,weekly_offs,expected_hours_per_day&tenant_id=eq.${tenantId}&is_active=eq.true`)
    const toCreate = Math.max(0, N_EMP - existing.length)
    console.log(`Employees: ${existing.length} existing, creating ${toCreate}`)
    const newEmps = []
    const usedNames = new Set(existing.map((e) => e.full_name))
    for (let i = 0; i < toCreate; i++) {
        let name
        do { name = `${pick(FIRST)} ${pick(LAST)}` } while (usedNames.has(name))
        usedNames.add(name)
        const [designation, department, basis, [lo, hi]] = pick(ROLES)
        newEmps.push({
            tenant_id: tenantId,
            branch_id: branchId,
            full_name: name,
            emp_code: `EMP-${pad(existing.length + i + 1, 3)}`,
            email: `${name.toLowerCase().replace(/\s+/g, ".")}@seed.local`,
            phone: `98${randInt(10000000, 99999999)}`,
            designation, department,
            employment_type: basis === "DAILY" ? "DAILY_WAGE" : "FULL_TIME",
            salary_basis: basis,
            base_amount: randInt(lo, hi),
            expected_hours_per_day: pick([8, 8, 9, 9, 9.5]),
            weekly_offs: [pick([0, 0, 1, 2])],   // mostly Sunday off
            date_of_joining: new Date(now.getFullYear() - 1, randInt(0, 11), randInt(1, 28)).toISOString().slice(0, 10),
            is_active: true,
        })
    }

    // ── attendance plan ─────────────────────────────────────────────────
    const allEmpMeta = [
        ...existing.map((e) => ({ id: e.id, offs: e.weekly_offs ?? [0], hours: Number(e.expected_hours_per_day ?? 9) })),
        // new employees get ids after insert
    ]
    // NOTE: PostgREST bulk inserts require every row in a request to carry
    // the SAME keys — so every row is emitted in one uniform shape with
    // nulls/zeros where a status has no times.
    const baseRow = (emp, dateStr, status) => ({
        tenant_id: tenantId, employee_id: emp.id, branch_id: branchId, work_date: dateStr,
        status, check_in: null, check_out: null,
        worked_minutes: 0, late_minutes: 0, overtime_minutes: 0,
        source: "ADMIN", notes: "seed", marked_by: ownerId,
    })
    const attendanceRowsFor = (emp) => {
        const rows = []
        for (const day of days) {
            const dow = day.getDay()
            const dateStr = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
            if ((emp.offs ?? [0]).includes(dow)) {
                rows.push(baseRow(emp, dateStr, "WEEKLY_OFF"))
                continue
            }
            const roll = Math.random()
            if (roll < 0.88) {
                const inH = 8 + rand(0.5, 1.6)            // 08:30–09:36
                const lateMin = Math.max(0, Math.round((inH - 9) * 60))
                const workH = emp.hours + rand(-0.4, 0.8)
                const ot = Math.random() < 0.07 ? randInt(30, 90) : 0
                const checkIn = new Date(day); checkIn.setHours(Math.floor(inH), Math.round((inH % 1) * 60), 0, 0)
                const checkOut = new Date(checkIn.getTime() + (workH * 60 + ot) * 60000)
                rows.push({
                    ...baseRow(emp, dateStr, "PRESENT"),
                    check_in: checkIn.toISOString(), check_out: checkOut.toISOString(),
                    worked_minutes: Math.round(workH * 60 + ot), late_minutes: lateMin, overtime_minutes: ot,
                })
            } else if (roll < 0.92) {
                const checkIn = new Date(day); checkIn.setHours(9, randInt(0, 30), 0, 0)
                const checkOut = new Date(checkIn.getTime() + 4 * 3600000)
                rows.push({
                    ...baseRow(emp, dateStr, "HALF_DAY"),
                    check_in: checkIn.toISOString(), check_out: checkOut.toISOString(), worked_minutes: 240,
                })
            } else if (roll < 0.96) {
                rows.push(baseRow(emp, dateStr, "LEAVE"))
            } else {
                rows.push(baseRow(emp, dateStr, "ABSENT"))
            }
        }
        return rows
    }

    // ── menu for invoices ───────────────────────────────────────────────
    let menu = await get(`menu_items?select=id,name,base_price,sale_price,gst_slab,hsn_code&tenant_id=eq.${tenantId}&is_active=eq.true&deleted_at=is.null&limit=200`)
    if (!menu.length) menu = FALLBACK_MENU.map(([name, price, slab]) => ({ id: null, name, base_price: price, sale_price: null, gst_slab: slab, hsn_code: null }))

    // ── invoice plan: bills/day with items + GST ────────────────────────
    const sequences = {}   // fyLabel → { startValue, allocated }
    async function seqBase(label) {
        if (!sequences[label]) {
            const rows = await get(`tenant_sequences?select=last_value&tenant_id=eq.${tenantId}&seq_type=eq.invoice&fy_label=eq.${encodeURIComponent(label)}`)
            sequences[label] = { base: rows[0]?.last_value ?? 0, allocated: 0 }
        }
        return sequences[label]
    }

    let planOrders = 0, planItems = 0
    const dayPlans = days.map((day) => {
        const n = randInt(BILLS_MIN, BILLS_MAX)
        planOrders += n
        const bills = Array.from({ length: n }, (_, i) => {
            const itemCount = randInt(1, 4)
            planItems += itemCount
            return { i, itemCount }
        })
        return { day, bills }
    })

    const totalAttendance = (existing.length + toCreate) * days.length
    console.log(`Plan: ${toCreate} employees · ~${totalAttendance} attendance rows · ${planOrders} invoices (~${planItems} line items)`)
    if (DRY) { console.log("--dry-run: no writes performed."); return }

    // ── 1. create employees ─────────────────────────────────────────────
    if (newEmps.length) {
        const created = await insert("hr_employees", newEmps, { returning: true })
        for (const e of created) {
            const src = newEmps.find((n) => n.emp_code === e.emp_code)
            allEmpMeta.push({ id: e.id, offs: src?.weekly_offs ?? [0], hours: Number(src?.expected_hours_per_day ?? 9) })
        }
        console.log(`✓ employees created: ${created.length}`)
    }

    // ── 2. attendance ───────────────────────────────────────────────────
    let attCount = 0
    for (const emp of allEmpMeta) {
        const rows = attendanceRowsFor(emp)
        for (const part of chunk(rows, 400)) {
            await upsert("hr_attendance", part, "tenant_id,employee_id,work_date")
            attCount += part.length
        }
        process.stdout.write(`\r  attendance: ${attCount}/${totalAttendance}`)
    }
    console.log(`\n✓ attendance rows: ${attCount}`)

    // ── 3. invoices ─────────────────────────────────────────────────────
    let billCount = 0
    for (const { day, bills } of dayPlans) {
        const label = fyLabel(day, fyStart)
        const seq = await seqBase(label)
        const orders = [], itemsByOrder = [], billRows = [], payRows = []
        for (let i = 0; i < bills.length; i++) {
            const ts = new Date(day); ts.setHours(randInt(11, 22), randInt(0, 59), randInt(0, 59), 0)
            const iso = ts.toISOString()
            const orderNumber = `SD-${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}-${i + 1}-${crypto.randomBytes(2).toString("hex")}`
            const lines = Array.from({ length: bills[i].itemCount }, () => {
                const m = pick(menu)
                const qty = randInt(1, 3)
                // Same sale-price rule the POS uses: honour sale_price only
                // when it's a real discount (> 0 and below base).
                const sale = Number(m.sale_price)
                const base = Number(m.base_price)
                const unit = m.sale_price != null && sale > 0 && sale < base ? sale : base
                const taxable = r2(unit * qty)
                const half = r2(taxable * Number(m.gst_slab) / 200)
                return { m, qty, unit, taxable, cgst: half, sgst: half, total: r2(taxable + 2 * half) }
            })
            const subtotal = r2(lines.reduce((s, l) => s + l.taxable, 0))
            const cgst = r2(lines.reduce((s, l) => s + l.cgst, 0))
            const sgst = r2(lines.reduce((s, l) => s + l.sgst, 0))
            const grand = r2(subtotal + cgst + sgst)
            seq.allocated += 1
            const invoiceNo = `${prefix}-${label}-${String(seq.base + seq.allocated).padStart(5, "0")}`
            orders.push({
                tenant_id: tenantId, order_number: orderNumber, status: "PAID",
                order_type: pick(["DINE_IN", "DINE_IN", "TAKEAWAY", "QSR"]),
                branch_id: branchId, created_by: ownerId, billed_by: ownerId,
                subtotal, taxable_amount: subtotal, cgst_amount: cgst, sgst_amount: sgst, grand_total: grand,
                created_at: iso, billed_at: iso, paid_at: iso,
            })
            itemsByOrder.push(lines)
            billRows.push({ invoiceNo, label, subtotal, cgst, sgst, grand, iso })
            payRows.push({ method: pick(["CASH", "CASH", "UPI", "UPI", "UPI", "CARD"]), amount: grand, iso })
        }
        const createdOrders = await insert("orders", orders, { returning: true })
        const orderIdByNumber = new Map(createdOrders.map((o) => [o.order_number, o.id]))
        const itemRows = []
        orders.forEach((o, idx) => {
            const oid = orderIdByNumber.get(o.order_number)
            for (const l of itemsByOrder[idx]) {
                itemRows.push({
                    tenant_id: tenantId, order_id: oid, menu_item_id: l.m.id,
                    item_name: l.m.name, hsn_code: l.m.hsn_code, gst_slab: l.m.gst_slab,
                    quantity: l.qty, unit_price: l.unit, taxable_amount: l.taxable,
                    cgst_amount: l.cgst, sgst_amount: l.sgst, igst_amount: 0, line_total: l.total,
                    created_at: o.created_at,
                })
            }
        })
        for (const part of chunk(itemRows, 400)) await insert("order_items", part)
        const billInserts = orders.map((o, idx) => ({
            tenant_id: tenantId, order_id: orderIdByNumber.get(o.order_number), branch_id: branchId,
            invoice_number: billRows[idx].invoiceNo, fy_label: billRows[idx].label, bill_status: "PAID",
            subtotal: billRows[idx].subtotal, taxable_amount: billRows[idx].subtotal,
            cgst_amount: billRows[idx].cgst, sgst_amount: billRows[idx].sgst, igst_amount: 0,
            service_charge: 0, order_discount: 0, round_off: 0,
            grand_total: billRows[idx].grand, is_inter_state: false,
            created_at: billRows[idx].iso,
        }))
        const createdBills = await insert("bills", billInserts, { returning: true })
        const payInserts = createdBills.map((b, idx) => ({
            tenant_id: tenantId, bill_id: b.id, method: payRows[idx].method,
            amount: payRows[idx].amount, received_by: ownerId, created_at: payRows[idx].iso,
            metadata: { seed: true },
        }))
        for (const part of chunk(payInserts, 400)) await insert("payments", part)
        billCount += createdBills.length
        process.stdout.write(`\r  invoices: ${billCount}/${planOrders}`)
    }
    console.log(`\n✓ invoices: ${billCount}`)

    // ── 4. advance the invoice counters so REAL bills continue after ours ─
    const seqUpserts = Object.entries(sequences)
        .filter(([, s]) => s.allocated > 0)
        .map(([label, s]) => ({ tenant_id: tenantId, seq_type: "invoice", fy_label: label, last_value: s.base + s.allocated }))
    if (seqUpserts.length) await upsert("tenant_sequences", seqUpserts, "tenant_id,seq_type,fy_label")
    console.log(`✓ invoice counters advanced: ${seqUpserts.map((s) => `${s.fy_label}→${s.last_value}`).join(", ")}`)
    console.log("\nDone. Use --cleanup to remove everything this script created.")
})().catch((e) => { console.error("\n✗", e.message); process.exit(1) })
