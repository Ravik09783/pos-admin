"use client"

import type { ExportDataset } from "./types"

/**
 * Generate a GSTR-1 JSON in the offline-utility schema (loosely v3.0.4).
 *
 * NOTE: This file is a *working* JSON for the CA to validate before upload.
 * It is NOT a signed final return; the CA / owner must run it through the
 * govt offline utility for any final hash / signing.
 */
export function buildGSTR1Json(data: ExportDataset): string {
    const fp = `${String(data.period.monthNum).padStart(2, "0")}${data.period.yearNum}`
    const valid = data.sales.filter((s) => s.bill_status !== "VOID")

    // ---- B2B (Table 4) ----
    const b2bByCtin = new Map<string, ReturnType<typeof b2bInvoice>[]>()
    for (const s of valid.filter((x) => x.customer_gstin)) {
        const list = b2bByCtin.get(s.customer_gstin!) ?? []
        list.push(b2bInvoice(s, data))
        b2bByCtin.set(s.customer_gstin!, list)
    }
    const b2b = Array.from(b2bByCtin.entries()).map(([ctin, inv]) => ({ ctin, inv }))

    // ---- B2C Large (Table 5) — inter-state invoices > ₹2.5 lakh ----
    const b2cl: Array<{ pos: string; inv: unknown[] }> = []
    const b2clMap = new Map<string, unknown[]>()
    for (const s of valid.filter((x) => !x.customer_gstin && x.is_inter_state && x.grand_total > 250_000)) {
        const pos = s.place_of_supply ?? "00"
        const arr = b2clMap.get(pos) ?? []
        arr.push(b2cLargeInvoice(s))
        b2clMap.set(pos, arr)
    }
    b2clMap.forEach((inv, pos) => b2cl.push({ pos, inv }))

    // ---- B2C Small (Table 7) — consolidated by POS + slab + sply_ty ----
    type B2cSKey = string
    const b2csMap = new Map<
        B2cSKey,
        {
            sply_ty: "INTER" | "INTRA"
            rt: number
            typ: "OE"
            pos: string
            txval: number
            iamt: number
            camt: number
            samt: number
            csamt: number
        }
    >()
    for (const s of valid.filter((x) => !x.customer_gstin && (!x.is_inter_state || x.grand_total <= 250_000))) {
        const pos = s.place_of_supply ?? "00"
        for (const it of s.items) {
            const sply_ty: "INTER" | "INTRA" = s.is_inter_state ? "INTER" : "INTRA"
            const k = `${sply_ty}|${pos}|${it.gst_slab}`
            const cur =
                b2csMap.get(k) ??
                {
                    sply_ty,
                    rt: it.gst_slab,
                    typ: "OE" as const,
                    pos,
                    txval: 0,
                    iamt: 0,
                    camt: 0,
                    samt: 0,
                    csamt: 0,
                }
            cur.txval = round(cur.txval + it.taxable_amount)
            cur.iamt  = round(cur.iamt  + it.igst_amount)
            cur.camt  = round(cur.camt  + it.cgst_amount)
            cur.samt  = round(cur.samt  + it.sgst_amount)
            b2csMap.set(k, cur)
        }
    }
    const b2cs = Array.from(b2csMap.values())

    // ---- HSN (Table 12) ----
    const hsn = {
        data: data.hsn_summary.map((h, i) => ({
            num: i + 1,
            hsn_sc: h.hsn_code,
            desc: h.description || "Restaurant services",
            uqc: h.uqc || "OTH",
            qty: round(h.total_quantity),
            val: round(h.total_value),
            txval: round(h.taxable_amount),
            iamt: round(h.igst),
            camt: round(h.cgst),
            samt: round(h.sgst),
            csamt: round(h.cess),
        })),
    }

    // ---- Document summary (nil-rated, exempt = N/A for restaurants normally) ----
    const docs = {
        doc_det: [
            {
                doc_num: 1,
                doc_typ: "Invoices for outward supply",
                docs: [
                    {
                        num: 1,
                        from: valid[0]?.invoice_number ?? "",
                        to: valid[valid.length - 1]?.invoice_number ?? "",
                        totnum: valid.length,
                        cancel: data.summary.void_count,
                        net_issue: valid.length,
                    },
                ],
            },
        ],
    }

    const payload = {
        gstin: data.tenant.gstin ?? "",
        fp,
        version: "GST3.0.4",
        hash: "hash",
        gt: round(data.summary.taxable_outward),
        cur_gt: round(data.summary.taxable_outward),
        b2b,
        b2cl,
        b2cs,
        hsn,
        doc_issue: docs,
        // unused-for-restaurants, included as empty
        cdnr: [],
        cdnur: [],
        exp: [],
        nil: { inv: [] },
    }

    return JSON.stringify(payload, null, 2)
}

function b2bInvoice(s: ExportDataset["sales"][number], data: ExportDataset) {
    const itms = s.items.map((it, idx) => ({
        num: idx + 1,
        itm_det: {
            txval: round(it.taxable_amount),
            rt: it.gst_slab,
            iamt: round(it.igst_amount),
            camt: round(it.cgst_amount),
            samt: round(it.sgst_amount),
            csamt: 0,
        },
    }))
    return {
        inum: s.invoice_number,
        idt: ddmmyyyy(s.invoice_date),
        val: round(s.grand_total),
        pos: s.place_of_supply ?? data.tenant.state_code ?? "00",
        rchrg: "N",
        inv_typ: "R",
        itms,
    }
}

function b2cLargeInvoice(s: ExportDataset["sales"][number]) {
    return {
        inum: s.invoice_number,
        idt: ddmmyyyy(s.invoice_date),
        val: round(s.grand_total),
        itms: s.items.map((it, idx) => ({
            num: idx + 1,
            itm_det: {
                txval: round(it.taxable_amount),
                rt: it.gst_slab,
                iamt: round(it.igst_amount),
                csamt: 0,
            },
        })),
    }
}

function ddmmyyyy(iso: string): string {
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`
}

function round(n: number): number {
    return Math.round(n * 100) / 100
}
