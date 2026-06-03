"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ChevronDown, LogOut, User as UserIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { createClient } from "@/lib/supabase/client"

/**
 * Super-admin user menu — small avatar-style dropdown shown in the
 * top-right of `/super-admin/*`. Hosts the actions the layout chrome
 * is otherwise missing:
 *   • "Back to my dashboard" (carried over from the original button)
 *   • Sign out (the missing affordance — without it a super-admin had
 *     to clear cookies manually to drop the session)
 *
 * Kept as a tiny client component so the rest of the layout stays a
 * pure server component.
 */
export function SuperAdminUserMenu({ email }: { email: string }) {
    const router = useRouter()
    const supabase = createClient()

    async function signOut() {
        await supabase.auth.signOut()
        toast.success("Signed out")
        router.push("/login")
        router.refresh()
    }

    // Two-letter initial from the email — falls back to a generic
    // user icon if the email is somehow empty.
    const initial = (email || "?").trim().charAt(0).toUpperCase() || "?"

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 pl-1.5 pr-2.5"
                    aria-label="Super-admin account menu"
                >
                    <span
                        aria-hidden
                        className="h-6 w-6 rounded-full grid place-items-center text-[11px] font-bold border border-border bg-destructive/15 text-destructive"
                    >
                        {initial}
                    </span>
                    <span className="hidden sm:inline truncate max-w-[160px] text-xs font-mono">
                        {email}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                    <div className="text-[11px] text-muted-foreground font-normal">Super-admin</div>
                    <div className="font-mono text-xs truncate">{email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem asChild>
                    <Link href="/dashboard">
                        <ArrowLeft className="h-4 w-4 mr-2 text-muted-foreground" />
                        Back to my dashboard
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href="/super-admin/profile">
                        <UserIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                        My profile
                    </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
