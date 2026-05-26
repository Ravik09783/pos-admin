import Link from "next/link"
import { ArrowLeft, Sparkles } from "lucide-react"

import { ThemeToggle } from "@/components/app-shell/theme-toggle"

// Login / signup / forgot-password / reset-password are all pure
// client-component forms with no server-side data access — Next.js
// can prerender this entire (auth) tree as a static shell. The
// `proxy.ts` "signed-in user → /dashboard" redirect runs before the
// page ever streams, so we don't need a dynamic gate here.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="relative min-h-screen overflow-x-hidden">
            {/* Background ornaments — same recipe as the landing page */}
            <div className="fixed inset-0 grid-bg pointer-events-none -z-10 opacity-40" />
            <div className="fixed inset-0 -z-10 pointer-events-none">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[600px] w-[1200px] rounded-full bg-primary/15 blur-[120px]" />
                <div className="absolute bottom-0 right-0 h-[400px] w-[800px] rounded-full bg-[hsl(var(--neon-magenta)/0.15)] blur-[100px]" />
            </div>

            {/* Header — branded logo + back-to-home link */}
            <header className="relative z-10 border-b border-border/40 bg-background/40 backdrop-blur-xl">
                <div className="container mx-auto flex items-center justify-between py-4 px-4">
                    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                        <span className="grid place-items-center h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-[hsl(var(--neon-magenta))] text-primary-foreground shadow-glow">
                            <Sparkles className="h-4 w-4" />
                        </span>
                        <span className="text-lg">RestoPOS</span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <Link
                            href="/"
                            className="hidden sm:inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Back to home
                        </Link>
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <div className="relative z-10 px-4 py-10 md:py-16">{children}</div>
        </div>
    )
}
