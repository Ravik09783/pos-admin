import { cn } from "@/lib/utils"

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "rounded-md bg-muted/60  from-muted/40 via-muted to-muted/40 animate-shimmer bg-[length:200%_100%]",
                className,
            )}
            {...props}
        />
    )
}
