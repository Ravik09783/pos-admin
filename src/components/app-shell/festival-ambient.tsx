"use client"

import { useEffect, useState } from "react"

import { useTheme } from "@/lib/theme/provider"
import type { ThemeId } from "@/lib/theme/themes"

/**
 * Festive emoji ambience — falling diyas for Diwali, snowflakes & santa for
 * Christmas, ghosts for Halloween, etc. Mounted once at the root so a single
 * particle layer floats behind every page when the user picks a festival
 * theme. Pointer-events: none → never blocks clicks; CSS-only animation →
 * GPU-cheap; desktop-only → no extra battery cost on phones; respects
 * prefers-reduced-motion and @media print.
 */

interface FestivalConfig {
    /** Emoji pool — each particle picks one at random. */
    emojis: string[]
    /** How many particles to spawn. More on bigger themes (christmas/newyear). */
    count: number
}

const FESTIVAL_AMBIENT: Partial<Record<ThemeId, FestivalConfig>> = {
    diwali:    { emojis: ["🪔", "✨", "🎆", "🌟", "🎇"], count: 26 },
    holi:      { emojis: ["🌸", "🌺", "🌷", "🎨", "🌹"], count: 24 },
    dussehra:  { emojis: ["🏹", "🔥", "🪔", "🚩", "🛕"], count: 20 },
    onam:      { emojis: ["🌺", "🌸", "🌼", "🍃", "🌻"], count: 22 },
    eid:       { emojis: ["🌙", "⭐", "✨", "🕌", "🪷"], count: 22 },
    christmas: { emojis: ["❄️", "🎄", "🎅", "🔔", "🎁", "⛄", "🌟"], count: 32 },
    newyear:   { emojis: ["🎆", "🎇", "🎉", "🥂", "✨", "🎊"], count: 30 },
    valentine: { emojis: ["❤️", "💖", "🌹", "💝", "💕"], count: 24 },
    halloween: { emojis: ["🎃", "👻", "🦇", "🕷️", "🕸️", "💀"], count: 22 },
}

interface Particle {
    id: number
    emoji: string
    /** Horizontal start position (vw). */
    left: number
    /** Fall duration in seconds — randomised so they don't sync up. */
    duration: number
    /** Negative delay = mid-air at mount so the screen isn't empty for 10s. */
    delay: number
    /** Horizontal drift over the fall, in vw. */
    drift: number
    /** Font size px. */
    size: number
    /** Final rotation in degrees, randomised so each one tumbles uniquely. */
    rotate: number
    /** 0.4–0.85 — keeps the ambience light, never overpowering. */
    opacity: number
}

/** Best-effort detection of "desktop with motion OK". We deliberately skip
 *  the particles on phones (battery + small screens get cluttered) and for
 *  users who set OS-level reduced-motion. */
function shouldRenderAmbience(): boolean {
    if (typeof window === "undefined") return false
    try {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false
        // 1024px ≈ small laptop / iPad-landscape; below that we skip.
        if (window.matchMedia("(max-width: 1023px)").matches) return false
    } catch { /* old browsers without matchMedia → just render */ }
    return true
}

function buildParticles(cfg: FestivalConfig): Particle[] {
    return Array.from({ length: cfg.count }, (_, i) => ({
        id: i,
        emoji: cfg.emojis[Math.floor(Math.random() * cfg.emojis.length)]!,
        left: Math.random() * 100,
        duration: 12 + Math.random() * 16,
        delay: -Math.random() * 25,
        drift: -25 + Math.random() * 50,
        size: 18 + Math.random() * 22,
        rotate: -180 + Math.random() * 540,
        opacity: 0.4 + Math.random() * 0.45,
    }))
}

export function FestivalAmbient() {
    const { theme } = useTheme()
    const cfg = FESTIVAL_AMBIENT[theme as ThemeId]
    const [particles, setParticles] = useState<Particle[]>([])

    useEffect(() => {
        if (!cfg) { setParticles([]); return }
        if (!shouldRenderAmbience()) { setParticles([]); return }
        setParticles(buildParticles(cfg))

        // Re-evaluate on resize so a user docking their laptop / rotating an
        // iPad picks up / drops the ambience without a full reload.
        function onResize() {
            if (!cfg) return
            if (!shouldRenderAmbience()) setParticles([])
            else setParticles((p) => (p.length === 0 ? buildParticles(cfg) : p))
        }
        window.addEventListener("resize", onResize)
        return () => window.removeEventListener("resize", onResize)
    }, [cfg])

    if (particles.length === 0) return null

    return (
        <div className="festival-ambient" aria-hidden="true">
            {particles.map((p) => (
                <span
                    key={p.id}
                    className="festival-particle"
                    style={{
                        left: `${p.left}%`,
                        fontSize: `${p.size}px`,
                        opacity: p.opacity,
                        animationDuration: `${p.duration}s`,
                        animationDelay: `${p.delay}s`,
                        ["--festival-drift" as string]: `${p.drift}vw`,
                        ["--festival-rotate" as string]: `${p.rotate}deg`,
                    } as React.CSSProperties}
                >
                    {p.emoji}
                </span>
            ))}
        </div>
    )
}
