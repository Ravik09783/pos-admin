"use client"

import { useMemo } from "react"
import { Check, Moon, Palette, PartyPopper, RotateCcw, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/lib/theme/provider"
import { DEFAULT_THEME, type ThemeDef } from "@/lib/theme/themes"
import { cn } from "@/lib/utils"

/**
 * Theme picker. The dropdown groups themes into three sections — Dark / Light /
 * Festivals — and lays each group out as a responsive grid: 1 column on mobile,
 * 2 columns on desktop. A "Reset to Neon" affordance lives at the bottom so
 * users who experimented their way into something unreadable can recover in
 * one click. Festival cards show a tiny sun/moon glyph because that group
 * mixes both modes (Holi is light, Diwali is dark, etc.).
 */
export function ThemeToggle({ align = "end" }: { align?: "start" | "center" | "end" }) {
    const { theme, setTheme, themes } = useTheme()
    const current = themes.find((t) => t.id === theme)
    const isDefault = theme === DEFAULT_THEME

    // Split into the three picker buckets once. Stable identity — the catalog
    // is a module-level constant that doesn't change at runtime.
    const groups = useMemo(() => {
        const dark: ThemeDef[] = []
        const light: ThemeDef[] = []
        const festival: ThemeDef[] = []
        for (const t of themes) {
            if (t.category === "festival") festival.push(t)
            else if (t.mode === "dark") dark.push(t)
            else light.push(t)
        }
        return { dark, light, festival }
    }, [themes])

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Change theme" aria-label="Change theme">
                    <Palette className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align={align}
                // Wide enough for 2 columns on desktop, capped at the viewport
                // on mobile so the dropdown never overflows.
                className="w-[min(calc(100vw-1rem),32rem)] p-0"
            >
                <DropdownMenuLabel className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>Theme</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {themes.length} options · {current?.mode ?? "—"}
                    </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="m-0" />

                <div className="max-h-[70vh] overflow-y-auto scrollbar-thin p-2 space-y-3">
                    <ThemeGroup
                        title="Dark themes"
                        icon={<Moon className="h-3.5 w-3.5" />}
                        themes={groups.dark}
                        selectedId={theme}
                        onPick={setTheme}
                        showModeGlyph={false}
                    />
                    <ThemeGroup
                        title="Light themes"
                        icon={<Sun className="h-3.5 w-3.5" />}
                        themes={groups.light}
                        selectedId={theme}
                        onPick={setTheme}
                        showModeGlyph={false}
                    />
                    <ThemeGroup
                        title="Festivals"
                        icon={<PartyPopper className="h-3.5 w-3.5" />}
                        themes={groups.festival}
                        selectedId={theme}
                        onPick={setTheme}
                        showModeGlyph
                    />
                </div>

                <DropdownMenuSeparator className="m-0" />
                <div className="p-1.5">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2 h-8 text-xs"
                        disabled={isDefault}
                        onClick={() => setTheme(DEFAULT_THEME)}
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {isDefault ? "Already on Neon (default)" : "Reset to Neon"}
                    </Button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function ThemeGroup({
    title,
    icon,
    themes,
    selectedId,
    onPick,
    showModeGlyph,
}: {
    title: string
    icon: React.ReactNode
    themes: ThemeDef[]
    selectedId: string
    onPick: (id: ThemeDef["id"]) => void
    showModeGlyph: boolean
}) {
    if (themes.length === 0) return null
    return (
        <section className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {icon}
                <span>{title}</span>
                <span className="text-muted-foreground/60">· {themes.length}</span>
            </div>
            {/* Single column on mobile, two columns from sm-up. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {themes.map((t) => (
                    <ThemeCard
                        key={t.id}
                        theme={t}
                        selected={t.id === selectedId}
                        onPick={() => onPick(t.id)}
                        showModeGlyph={showModeGlyph}
                    />
                ))}
            </div>
        </section>
    )
}

function ThemeCard({
    theme,
    selected,
    onPick,
    showModeGlyph,
}: {
    theme: ThemeDef
    selected: boolean
    onPick: () => void
    showModeGlyph: boolean
}) {
    return (
        <button
            type="button"
            onClick={onPick}
            title={theme.blurb}
            className={cn(
                "group flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                "hover:bg-accent/60 active:scale-[0.98]",
                selected
                    ? "border-primary/70 bg-accent/60 ring-1 ring-primary/40"
                    : "border-border/60",
            )}
        >
            <div className="flex shrink-0 -space-x-1">
                {theme.swatches.map((c, i) => (
                    <span
                        key={i}
                        className="h-4 w-4 rounded-full border border-border/80"
                        style={{ background: c }}
                    />
                ))}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-none flex items-center gap-1.5">
                    <span className="truncate">{theme.name}</span>
                    {showModeGlyph && (
                        theme.mode === "dark"
                            ? <Moon className="h-3 w-3 shrink-0 text-muted-foreground" />
                            : <Sun className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    {theme.id === DEFAULT_THEME && (
                        <span className="text-[9px] uppercase tracking-wider text-primary/80 font-semibold shrink-0">default</span>
                    )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{theme.blurb}</div>
            </div>
            {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
        </button>
    )
}
