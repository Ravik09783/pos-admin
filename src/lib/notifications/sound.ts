/**
 * Short, pleasant two-tone chime played when a new QR order arrives.
 *
 * Generated via the Web Audio API rather than a static asset so it
 * works offline, has no bundle weight, and doesn't depend on any
 * provided file existing in /public.
 *
 * Browser autoplay policy: audio can only start after the user has
 * interacted with the page at least once. The dashboard requires
 * login, so by the time this runs the user has clicked SOMETHING —
 * autoplay should succeed. If it doesn't (rare), we swallow the error
 * silently; the OS notification's built-in sound is the fallback.
 *
 * Cache the AudioContext between calls — creating a new one on every
 * order trips a Chrome warning after a few invocations.
 */
let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
    if (typeof window === "undefined") return null
    if (ctx && ctx.state !== "closed") return ctx
    try {
        const AudioCtor = window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioCtor) return null
        ctx = new AudioCtor()
        return ctx
    } catch {
        return null
    }
}

/** Two-tone "ding-dong" — a 880 Hz note followed by a 660 Hz note. */
export function playOrderChime() {
    const audio = getContext()
    if (!audio) return

    // If the context is suspended (some browsers pause it after a while),
    // try to resume — silently fails if the autoplay policy refuses.
    if (audio.state === "suspended") {
        audio.resume().catch(() => {})
    }

    try {
        beep(audio, 880, audio.currentTime, 0.18)
        beep(audio, 660, audio.currentTime + 0.22, 0.28)
    } catch {
        /* swallow — the OS notif sound covers the failure */
    }
}

function beep(audio: AudioContext, freq: number, startAt: number, durationSec: number) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = "sine"
    osc.frequency.value = freq
    // Gentle fade-in/out so it doesn't pop in the speakers.
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(0.18, startAt + 0.02)
    gain.gain.linearRampToValueAtTime(0, startAt + durationSec)
    osc.connect(gain).connect(audio.destination)
    osc.start(startAt)
    osc.stop(startAt + durationSec + 0.02)
}
