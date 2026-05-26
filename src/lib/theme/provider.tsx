"use client"

/**
 * Theme provider. The inline script in `<head>` already applied the saved
 * theme before hydration (see `themeInitScript`). This provider just exposes
 * a hook + setter so React can update it at runtime.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react"

import { DEFAULT_THEME, isTheme, THEMES, THEME_STORAGE_KEY, type ThemeDef, type ThemeId } from "./themes"

interface ThemeCtx {
    theme: ThemeId
    setTheme: (id: ThemeId) => void
    themes: ThemeDef[]
}

const Ctx = createContext<ThemeCtx | null>(null)

function applyTheme(id: ThemeId) {
    if (typeof document === "undefined") return
    const def = THEMES.find((t) => t.id === id)
    if (!def) return
    const html = document.documentElement
    html.setAttribute("data-theme", id)
    if (def.mode === "dark") {
        html.classList.add("dark")
        html.classList.remove("light")
    } else {
        html.classList.remove("dark")
        html.classList.add("light")
    }
}

function readInitialTheme(): ThemeId {
    if (typeof window === "undefined") return DEFAULT_THEME
    // The pre-hydration script already wrote the right attribute; trust it.
    const fromDom = document.documentElement.getAttribute("data-theme")
    if (isTheme(fromDom)) return fromDom
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY)
        if (isTheme(stored)) return stored
    } catch { /* private mode */ }
    return DEFAULT_THEME
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME)

    // After mount, sync state with whatever the pre-hydration script applied.
    useEffect(() => { setThemeState(readInitialTheme()) }, [])

    // Cross-tab sync: if the user changes the theme in another tab, mirror it
    // here without a reload. Fires when localStorage changes in any other
    // window of the same origin.
    useEffect(() => {
        function onStorage(e: StorageEvent) {
            if (e.key !== THEME_STORAGE_KEY) return
            const next = e.newValue
            if (isTheme(next) && next !== theme) {
                applyTheme(next)
                setThemeState(next)
            }
        }
        window.addEventListener("storage", onStorage)
        return () => window.removeEventListener("storage", onStorage)
    }, [theme])

    const setTheme = useCallback((id: ThemeId) => {
        setThemeState(id)
        applyTheme(id)
        try { localStorage.setItem(THEME_STORAGE_KEY, id) } catch { /* ignore */ }
    }, [])

    return <Ctx.Provider value={{ theme, setTheme, themes: THEMES }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
    const v = useContext(Ctx)
    if (!v) {
        // Outside the provider (e.g. unit tests) — fall back to a no-op so the
        // hook never throws on the server / in isolation.
        return {
            theme: DEFAULT_THEME,
            setTheme: () => { /* no-op */ },
            themes: THEMES,
        }
    }
    return v
}
