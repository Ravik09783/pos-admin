"use client"

/**
 * Self-service time clock, shown at the bottom of the /menu launcher.
 *
 * Renders ONLY for a signed-in user who is linked to an hr_employees row
 * (hr_employees.user_id = auth.uid()). Everyone else sees nothing — the
 * card simply doesn't mount, so non-employees aren't shown a dead widget.
 */

import { useCallback, useEffect, useState } from "react"
import { Clock, Loader2, LogIn, LogOut } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { formatMinutesAsHours } from "@/lib/hr/attendance"

function todayStr(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function timeOf(iso: string | null | undefined): string {
    if (!iso) return ""
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

interface State {
    employeeId: string
    name: string
    checkIn: string | null
    checkOut: string | null
    workedMinutes: number
}

export function SelfPunchCard() {
    const supabase = createClient()
    const [loaded, setLoaded] = useState(false)
    const [state, setState] = useState<State | null>(null)
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        const { data: auth } = await supabase.auth.getUser()
        if (!auth.user) { setLoaded(true); return }
        const { data: emp } = await supabase
            .from("hr_employees")
            .select("id, full_name")
            .eq("user_id", auth.user.id)
            .eq("is_active", true)
            .maybeSingle() as { data: { id: string; full_name: string } | null }
        if (!emp) { setLoaded(true); return }

        const { data: att } = await supabase
            .from("hr_attendance")
            .select("check_in, check_out, worked_minutes")
            .eq("employee_id", emp.id)
            .eq("work_date", todayStr())
            .maybeSingle() as { data: { check_in: string | null; check_out: string | null; worked_minutes: number } | null }

        setState({
            employeeId: emp.id,
            name: emp.full_name,
            checkIn: att?.check_in ?? null,
            checkOut: att?.check_out ?? null,
            workedMinutes: att?.worked_minutes ?? 0,
        })
        setLoaded(true)
    }, [supabase])

    useEffect(() => { load() }, [load])

    async function punch(action: "IN" | "OUT") {
        setBusy(true)
        try {
            const { data, error } = await supabase.rpc("hr_self_punch" as never, { p_action: action } as never)
            if (error) throw new Error(error.message)
            // Update straight from the RPC result rather than re-querying by the
            // browser's local "today" — keeps the card correct even when the
            // staffer's device timezone differs from the restaurant's.
            const res = data as { check_in: string | null; check_out: string | null; worked_minutes: number } | null
            if (res) {
                setState((s) => s ? { ...s, checkIn: res.check_in, checkOut: res.check_out, workedMinutes: res.worked_minutes ?? 0 } : s)
            }
            toast.success(action === "IN" ? "Punched in — have a great shift!" : "Punched out — see you next time!")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not record punch")
        } finally {
            setBusy(false)
        }
    }

    // Not a linked employee (or still resolving) → render nothing.
    if (!loaded || !state) return null

    const punchedIn = Boolean(state.checkIn)
    const punchedOut = Boolean(state.checkOut)

    return (
        <Card className="border-primary/20 bg-primary/[0.03]">
            <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                    <div className="grid place-items-center h-11 w-11 rounded-xl bg-primary/15 text-primary shrink-0">
                        <Clock className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="font-semibold text-sm">My attendance · today</div>
                        <div className="text-xs text-muted-foreground">
                            {punchedIn ? <>In at {timeOf(state.checkIn)}</> : "Not punched in yet"}
                            {punchedOut && <> · Out at {timeOf(state.checkOut)} · {formatMinutesAsHours(state.workedMinutes)}</>}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant={punchedIn ? "outline" : "neon"}
                        disabled={busy || punchedIn}
                        onClick={() => punch("IN")}
                    >
                        {busy && !punchedIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                        Punch in
                    </Button>
                    <Button
                        variant={punchedIn && !punchedOut ? "neon" : "outline"}
                        disabled={busy || !punchedIn || punchedOut}
                        onClick={() => punch("OUT")}
                    >
                        {busy && punchedIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                        Punch out
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
