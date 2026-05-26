"use client"

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Props {
    page: number               // zero-indexed
    pageSize: number
    total: number              // total rows (undefined / null when unknown — pass 0)
    pageSizes?: number[]
    onPageChange: (page: number) => void
    onPageSizeChange: (size: number) => void
    className?: string
}

export function Pagination({
    page, pageSize, total,
    pageSizes = [25, 50, 100, 250],
    onPageChange, onPageSizeChange,
    className,
}: Props) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const start = total === 0 ? 0 : page * pageSize + 1
    const end = Math.min((page + 1) * pageSize, total)

    return (
        <div className={`flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm ${className ?? ""}`}>
            <div className="text-muted-foreground">
                {total === 0
                    ? "0 results"
                    : <>Showing <span className="font-medium text-foreground">{start}-{end}</span> of <span className="font-medium text-foreground">{total}</span></>}
            </div>
            <div className="flex items-center gap-2">
                <Select value={String(pageSize)} onValueChange={(v) => { onPageSizeChange(Number(v)); onPageChange(0) }}>
                    <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{pageSizes.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-8 w-8"
                        onClick={() => onPageChange(0)} disabled={page === 0}><ChevronsLeft className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" className="h-8 w-8"
                        onClick={() => onPageChange(page - 1)} disabled={page === 0}><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="px-2 text-xs tabular-nums">
                        Page <span className="font-semibold text-foreground">{page + 1}</span> / {totalPages}
                    </span>
                    <Button size="icon" variant="outline" className="h-8 w-8"
                        onClick={() => onPageChange(page + 1)} disabled={page + 1 >= totalPages}><ChevronRight className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" className="h-8 w-8"
                        onClick={() => onPageChange(totalPages - 1)} disabled={page + 1 >= totalPages}><ChevronsRight className="h-4 w-4" /></Button>
                </div>
            </div>
        </div>
    )
}
