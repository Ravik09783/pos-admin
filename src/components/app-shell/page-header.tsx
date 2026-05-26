"use client"

import { motion } from "framer-motion"

import { Badge } from "@/components/ui/badge"

interface PageHeaderProps {
    /** Small uppercase kicker shown above the title (e.g. "OPERATIONS"). */
    kicker?: string
    /** Plain prefix of the title (e.g. "Run your kitchen"). */
    title: string
    /** Highlighted suffix rendered in the cyan→magenta gradient. */
    highlight?: string
    /** Subtitle/description below the title. */
    description?: React.ReactNode
    /** Right-aligned action area (buttons, links). */
    actions?: React.ReactNode
    /** Tighter spacing for table-heavy pages. */
    compact?: boolean
}

/**
 * Shared page header used across the authenticated app. Gives every inner
 * page the same gradient-title + neon-badge + framer-motion entry treatment
 * as the homepage, so the visual language is consistent end-to-end.
 *
 * Usage:
 *   <PageHeader
 *       kicker="Operations"
 *       title="Orders"
 *       description="Search, filter, and export every order."
 *       actions={<Button variant="neon">Export CSV</Button>}
 *   />
 */
export function PageHeader({
    kicker,
    title,
    highlight,
    description,
    actions,
    compact,
}: PageHeaderProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className={compact ? "flex items-start justify-between gap-3 flex-wrap mb-4" : "flex items-start justify-between gap-3 flex-wrap mb-6"}
        >
            <div className="min-w-0">
                {kicker && (
                    <Badge variant="outline" className="mb-2 text-[10px] uppercase tracking-wider">
                        {kicker}
                    </Badge>
                )}
                <h1 className={compact
                    ? "text-2xl md:text-3xl font-bold tracking-tight"
                    : "text-3xl md:text-4xl font-bold tracking-tight"}
                >
                    {title}
                    {highlight && (
                        <>{" "}<span className="text-gradient">{highlight}</span></>
                    )}
                </h1>
                {description && (
                    <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">{description}</p>
                )}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </motion.div>
    )
}
