import Link from "next/link"
import { Compass } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function NotFound() {
    return (
        <div className="min-h-screen grid place-items-center p-6">
            <Card className="max-w-md w-full neon-border">
                <CardContent className="text-center py-12 space-y-4">
                    <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-primary/15 text-primary">
                        <Compass className="h-7 w-7" />
                    </div>
                    <h1 className="text-3xl font-bold">404</h1>
                    <p className="text-muted-foreground">This page doesn&apos;t exist (or got moved).</p>
                    <Button asChild variant="neon"><Link href="/dashboard">Back to dashboard</Link></Button>
                </CardContent>
            </Card>
        </div>
    )
}
