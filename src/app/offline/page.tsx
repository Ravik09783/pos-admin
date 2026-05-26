import Link from "next/link"
import { WifiOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function OfflinePage() {
    return (
        <div className="min-h-screen grid place-items-center p-6">
            <Card className="max-w-md w-full neon-border">
                <CardContent className="py-10 text-center space-y-4">
                    <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-warning/15 text-warning">
                        <WifiOff className="h-7 w-7" />
                    </div>
                    <h1 className="text-2xl font-bold">You're offline</h1>
                    <p className="text-muted-foreground">
                        RestoPOS needs an internet connection for live data. Once you're back online, the app will sync automatically.
                    </p>
                    <div className="flex gap-2 justify-center">
                        <Button asChild variant="neon"><Link href="/dashboard">Try again</Link></Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
