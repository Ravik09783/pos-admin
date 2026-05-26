import { redirect } from "next/navigation"

// The bills listing was merged into /orders (Sales) on 2026-05-18. Bill
// detail/print still lives at /bills/[id] — only this listing route became
// a redirect, so any bookmarks land in the right place.
export default function BillsPage() {
    redirect("/orders")
}
