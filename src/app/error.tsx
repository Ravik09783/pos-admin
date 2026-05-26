"use client"

import Link from "next/link"
import { AlertTriangle, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

/**
 * Per-route error boundary. Rendered INSIDE the root layout — must NOT include
 * <html> or <body> (those belong only in global-error.tsx).
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <div className="min-h-screen grid place-items-center p-6">
            <Card className="max-w-md w-full neon-border">
                <CardContent className="text-center py-12 space-y-4">
                    <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-destructive/15 text-destructive">
                        <AlertTriangle className="h-7 w-7" />
                    </div>
                    <h1 className="text-2xl font-bold">Something broke</h1>
                    <p className="text-muted-foreground text-sm">
                        We hit an unexpected error. Try again, or head back to the dashboard.
                    </p>
                    {error.digest && (
                        <code className="text-[10px] text-muted-foreground block break-all">{error.digest}</code>
                    )}
                    <div className="flex gap-2 justify-center">
                        <Button variant="outline" onClick={reset}><RefreshCw className="h-4 w-4" /> Try again</Button>
                        <Button asChild variant="neon"><Link href="/dashboard">Dashboard</Link></Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
