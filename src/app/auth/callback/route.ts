import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    // Default landing is the role-aware launcher (/menu). Brand-new
    // OWNERs whose tenant isn't set up yet still get caught by the
    // (app)/layout.tsx guard and bounced to /onboarding from here, so
    // this default is safe even for first-confirmation users.
    const next = url.searchParams.get("next") ?? "/menu"

    if (code) {
        const supabase = await createClient()
        await supabase.auth.exchangeCodeForSession(code)
    }
    return NextResponse.redirect(new URL(next, request.url))
}
