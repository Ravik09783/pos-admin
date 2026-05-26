"use client"

import Link from "next/link"
import { BookOpen, ArrowRight } from "lucide-react"

import { NavBody, NavBranding } from "./nav"
import type { UserRole } from "@/types/database"

export function Sidebar({ role }: { role: UserRole }) {
    // The Setup guide link is most useful for the people who actually
    // configure the restaurant — OWNER and MANAGER. Cashiers / kitchen
    // / delivery don't need it cluttering their sidebar.
    const showSetupGuide = role === "OWNER" || role === "MANAGER"

    return (
        // `sticky top-0 h-screen` pins the sidebar to the viewport and
        // gives it a bounded height so the inner `<NavBody>` (which is
        // already `flex-1 overflow-auto`) actually has something to
        // overflow against. Without this the aside grew with its
        // `<main>` sibling and the nav never produced a scrollbar — the
        // page scrolled instead, hiding the bottom-of-list items above
        // the fold on shorter screens.
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border/50 bg-card/40 backdrop-blur-xl sticky top-0 h-screen">
            <NavBranding />
            <NavBody role={role} />

            {/* Bottom-pinned utilities. `shrink-0` keeps these from
              * collapsing when the nav above runs long. */}
            <div className="px-3 pb-4 space-y-2 shrink-0">
                {/* Setup guide link. The /setup-guide route auto-detects
                  * the tenant's country server-side and redirects to
                  * the India or International guide, so we don't need
                  * to know the country here at all. */}
                {showSetupGuide && (
                    <Link
                        href="/setup-guide"
                        className="group flex items-center gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2 text-xs transition-colors hover:border-primary/50 hover:bg-primary/[0.1]"
                    >
                        <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                            <div className="font-semibold text-foreground">Setup guide</div>
                            <div className="text-muted-foreground text-[10px] leading-tight">
                                Step-by-step for your country
                            </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
                    </Link>
                )}

                {role === "OWNER" && (
                    <div className="text-xs text-muted-foreground">
                        <div className="rounded-md bg-muted/40 p-3">
                            <div className="font-semibold text-foreground">CA Export</div>
                            Hit it at month-end and email the ZIP to your accountant.
                        </div>
                    </div>
                )}
            </div>
        </aside>
    )
}
