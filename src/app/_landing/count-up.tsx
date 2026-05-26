"use client"

import { useEffect, useRef, useState } from "react"

export function CountUp({ to, duration = 1400 }: { to: number; duration?: number }) {
    const [val, setVal] = useState(0)
    const ref = useRef<HTMLSpanElement>(null)
    const seen = useRef(false)

    useEffect(() => {
        const el = ref.current
        if (!el) return
        const io = new IntersectionObserver(([entry]) => {
            if (!entry?.isIntersecting || seen.current) return
            seen.current = true
            const start = performance.now()
            const tick = (now: number) => {
                const progress = Math.min(1, (now - start) / duration)
                // ease-out cubic
                const eased = 1 - Math.pow(1 - progress, 3)
                setVal(Math.floor(to * eased))
                if (progress < 1) requestAnimationFrame(tick)
                else setVal(to)
            }
            requestAnimationFrame(tick)
        }, { threshold: 0.5 })
        io.observe(el)
        return () => io.disconnect()
    }, [to, duration])

    return <span ref={ref} className="tabular-nums">{val}</span>
}
