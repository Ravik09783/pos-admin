"use client"

import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Print trigger for the public bill page. Lives in its own client
 *  component so the surrounding server-rendered page stays a clean
 *  prerender. */
export function PublicBillPrintButton() {
    return (
        <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
        </Button>
    )
}
