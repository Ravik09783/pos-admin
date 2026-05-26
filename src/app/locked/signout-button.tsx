"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Loader2, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

/** Tiny client wrapper around supabase.auth.signOut() — used by the
 *  /locked page where the user is authenticated but blocked. Pushes back
 *  to /login after the cookie is cleared so the next request hits the
 *  unauthenticated path. */
export function LockedSignOutButton() {
    const router = useRouter()
    const [busy, setBusy] = useState(false)
    async function onSignOut() {
        setBusy(true)
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/login")
    }
    return (
        <Button type="button" variant="outline" className="w-full" onClick={onSignOut} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Sign out
        </Button>
    )
}
