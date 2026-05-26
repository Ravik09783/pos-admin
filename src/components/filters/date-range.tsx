"use client"

import { useState } from "react"
import { Calendar, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export interface DateRange {
    from: string | null   // YYYY-MM-DD
    to: string | null
}

interface Props {
    value: DateRange
    onChange: (v: DateRange) => void
    className?: string
}

const PRESETS = [
    { label: "Today", build: () => { const d = new Date(); const s = d.toISOString().slice(0,10); return { from: s, to: s } } },
    { label: "Yesterday", build: () => { const d = new Date(); d.setDate(d.getDate()-1); const s = d.toISOString().slice(0,10); return { from: s, to: s } } },
    { label: "Last 7 days", build: () => { const t = new Date(); const f = new Date(); f.setDate(f.getDate()-6); return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10) } } },
    { label: "Last 30 days", build: () => { const t = new Date(); const f = new Date(); f.setDate(f.getDate()-29); return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10) } } },
    { label: "This month", build: () => { const t = new Date(); const f = new Date(t.getFullYear(), t.getMonth(), 1); return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10) } } },
    { label: "Last month", build: () => { const t = new Date(); const f = new Date(t.getFullYear(), t.getMonth()-1, 1); const e = new Date(t.getFullYear(), t.getMonth(), 0); return { from: f.toISOString().slice(0,10), to: e.toISOString().slice(0,10) } } },
    { label: "This FY", build: () => {
        const now = new Date()
        const fyStart = now.getMonth() >= 3
            ? new Date(now.getFullYear(), 3, 1)
            : new Date(now.getFullYear() - 1, 3, 1)
        return { from: fyStart.toISOString().slice(0,10), to: now.toISOString().slice(0,10) }
    } },
] as const

export function DateRangePicker({ value, onChange, className }: Props) {
    const [open, setOpen] = useState(false)
    const label = !value.from && !value.to
        ? "All time"
        : value.from === value.to
            ? formatLabel(value.from)
            : `${formatLabel(value.from)} → ${formatLabel(value.to)}`

    return (
        <div className={cn("relative", className)}>
            <Button variant="outline" size="sm" onClick={() => setOpen(!open)} className="gap-2">
                <Calendar className="h-3.5 w-3.5" />
                {label}
                {(value.from || value.to) && (
                    <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); onChange({ from: null, to: null }); setOpen(false) }}
                        className="ml-1 grid place-items-center h-4 w-4 rounded-full hover:bg-accent"
                    >
                        <X className="h-3 w-3" />
                    </span>
                )}
            </Button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute top-10 left-0 z-50 w-[320px] rounded-md border border-border bg-popover/95 backdrop-blur-xl shadow-glow p-3 space-y-3">
                        <div className="grid grid-cols-2 gap-1.5">
                            {PRESETS.map((p) => (
                                <Button
                                    key={p.label}
                                    variant="ghost"
                                    size="sm"
                                    className="justify-start h-8 text-xs"
                                    onClick={() => { onChange(p.build()); setOpen(false) }}
                                >
                                    {p.label}
                                </Button>
                            ))}
                        </div>
                        <div className="border-t border-border/40 pt-3 space-y-2">
                            <Label className="text-xs">Custom range</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <Input type="date" value={value.from ?? ""} onChange={(e) => onChange({ from: e.target.value || null, to: value.to })} />
                                <Input type="date" value={value.to ?? ""} onChange={(e) => onChange({ from: value.from, to: e.target.value || null })} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

function formatLabel(s: string | null) {
    if (!s) return "—"
    return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })
}
