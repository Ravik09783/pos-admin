import { NextResponse } from "next/server"

import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * GET /api/public/invite/:token
 * Returns invite details so the /invite/[token] page can render before
 * the user is signed in. No auth required (token IS the credential).
 */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ token: string }> },
) {
    const { token } = await params
    if (!token || token.length < 8) {
        return NextResponse.json({ error: "invalid token" }, { status: 400 })
    }
    const supabase = createServiceRoleClient()
    const { data: invite } = await supabase
        .from("staff_invites")
        .select("id, email, role, full_name, status, expires_at, branch_id, tenant_id, created_at")
        .eq("token", token)
        .maybeSingle()
    if (!invite) return NextResponse.json({ error: "not_found" }, { status: 404 })

    const i = invite as {
        id: string; email: string; role: string; full_name: string | null;
        status: string; expires_at: string; branch_id: string | null; tenant_id: string; created_at: string;
    }

    const { data: tenant } = await supabase
        .from("tenants").select("name, logo_url, city").eq("id", i.tenant_id).maybeSingle()

    const expired = new Date(i.expires_at) < new Date()
    const status: "valid" | "accepted" | "revoked" | "expired" =
        i.status === "ACCEPTED" ? "accepted"
            : i.status === "REVOKED" ? "revoked"
            : expired ? "expired"
            : "valid"

    return NextResponse.json({
        invite: {
            email: i.email,
            role: i.role,
            full_name: i.full_name,
            expires_at: i.expires_at,
            branch_id: i.branch_id,
        },
        tenant: tenant ? { name: (tenant as { name?: string }).name, logo_url: (tenant as { logo_url?: string }).logo_url, city: (tenant as { city?: string }).city } : null,
        status,
    })
}
