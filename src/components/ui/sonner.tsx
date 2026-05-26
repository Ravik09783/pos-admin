"use client"

import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

export function Toaster(props: ToasterProps) {
    return (
        <Sonner
            theme="dark"
            toastOptions={{
                classNames: {
                    toast:
                        "group toast group-[.toaster]:bg-card/95 group-[.toaster]:backdrop-blur-xl group-[.toaster]:border-border/70 group-[.toaster]:text-foreground group-[.toaster]:shadow-glow",
                    description: "group-[.toast]:text-muted-foreground",
                    actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
                    cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
                },
            }}
            {...props}
        />
    )
}
