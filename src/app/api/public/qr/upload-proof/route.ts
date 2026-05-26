import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * POST /api/public/qr/upload-proof
 * Multipart form-data:
 *   file:           image/* (max 5MB)
 *   order_id:       uuid
 *   amount:         numeric string
 *   customer_name:  optional
 *   customer_phone: optional
 *   upi_id_used:    optional
 *
 * Stores the screenshot in the payment-proofs bucket and writes a row to
 * qr_payment_proofs. Owner gets it in real-time on /pending-orders.
 */
export async function POST(req: Request) {
    let form: FormData
    try { form = await req.formData() } catch { return NextResponse.json({ error: "invalid form" }, { status: 400 }) }

    const file = form.get("file") as File | null
    const orderId = form.get("order_id") as string | null
    const amount = form.get("amount") as string | null
    const customerName = (form.get("customer_name") as string | null) ?? null
    const customerPhone = (form.get("customer_phone") as string | null) ?? null
    const upiIdUsed = (form.get("upi_id_used") as string | null) ?? null

    if (!file || !orderId || !amount) {
        return NextResponse.json({ error: "missing fields" }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "file too large (max 5MB)" }, { status: 413 })
    }
    if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "image required" }, { status: 415 })
    }

    const supabase = createServiceRoleClient()
    const { data: order } = await supabase.from("orders").select("tenant_id, awaiting_confirmation").eq("id", orderId).maybeSingle()
    if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 })
    const o = order as { tenant_id: string; awaiting_confirmation: boolean }
    if (!o.awaiting_confirmation) {
        return NextResponse.json({ error: "order is not awaiting payment" }, { status: 409 })
    }

    // Upload screenshot
    const ext = file.name.split(".").pop() ?? "png"
    const path = `${o.tenant_id}/${orderId}/${Date.now()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: ue } = await supabase.storage
        .from("payment-proofs")
        .upload(path, buffer, { contentType: file.type, upsert: false })
    if (ue) return NextResponse.json({ error: ue.message }, { status: 500 })
    const { data: { publicUrl } } = supabase.storage.from("payment-proofs").getPublicUrl(path)

    // Write proof row
    const { data: proof, error: pe } = await supabase
        .from("qr_payment_proofs")
        .insert({
            tenant_id: o.tenant_id,
            order_id: orderId,
            amount: Number(amount),
            screenshot_url: publicUrl,
            customer_name: customerName,
            customer_phone: customerPhone,
            upi_id_used: upiIdUsed,
            status: "PENDING",
        })
        .select("id")
        .maybeSingle()
    if (pe) return NextResponse.json({ error: pe.message }, { status: 500 })

    return NextResponse.json({ ok: true, proof_id: (proof as { id: string }).id, screenshot_url: publicUrl })
}

export const dynamic = "force-dynamic"
export const maxDuration = 30
