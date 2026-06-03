"use client"

import { ThemeToggle } from "./theme-toggle"

/**
 * Thin app-shell footer pinned below `<main>`. Hosts low-frequency
 * controls that don't deserve real estate in the topbar — currently
 * the theme picker, with room to grow (build version, last-sync
 * timestamp, build hash, support link).
 *
 * Sits inside the `h-dvh flex flex-col` outer container of AppShell,
 * so it stays at the bottom of the viewport while `<main>` scrolls
 * internally. `shrink-0` keeps it a fixed height regardless of
 * content above.
 */
export function AppFooter() {
    return (
        <footer className="shrink-0 border-t border-border/60 bg-card/40 backdrop-blur-xl">
            <div className="container mx-auto flex items-center justify-between gap-3 px-3 md:px-6 py-1.5 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate">
                        &copy; {new Date().getFullYear()} RestoPOS
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {/* Theme picker opens UPWARD from the footer so the
                      * popup doesn't try to extend past the bottom of
                      * the viewport. */}
                    <ThemeToggle align="end" side="top" />
                </div>
            </div>
        </footer>
    )
}
