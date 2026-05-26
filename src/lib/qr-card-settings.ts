import type { QrCardSettings } from "@/types/database"

/** Authoritative defaults. The original (pre-customization) card used the
 *  cyan→purple brand gradient and showed name, city, logo. Keep those as
 *  the defaults so a tenant who never visits the customization panel sees
 *  exactly the card they had before this feature shipped. */
export const QR_CARD_DEFAULTS: Required<QrCardSettings> = {
    show_restaurant_name: true,
    show_city: true,
    show_logo: true,
    header_color_1: "#06b6d4",
    header_color_2: "#a855f7",
    use_solid_header: false,
    custom_text: "",
    qr_size: "md",
    qr_size_custom_percent: 55,
}

/** Map the preset + custom value to the actual QR width as a percentage
 *  of the card. Applied uniformly to the HTML preview (% of card div)
 *  and the PNG canvas (% of 1200px), so what admins see matches what
 *  prints. The chosen presets bracket a comfortable scan range — too
 *  small fails to scan from across a table, too big eats into the card
 *  layout. */
export function qrSizePercent(saved: Required<QrCardSettings>): number {
    if (saved.qr_size === "sm") return 42
    if (saved.qr_size === "md") return 53
    if (saved.qr_size === "lg") return 66
    const pct = Number(saved.qr_size_custom_percent) || 55
    return Math.max(30, Math.min(80, pct))
}

/** Merge whatever the tenant has saved on top of the defaults, so callers
 *  can read every field without null-checking. Empty/invalid hex strings
 *  fall back to the default for that field. */
export function resolveQrCardSettings(saved: QrCardSettings | null | undefined): Required<QrCardSettings> {
    const s = saved ?? {}
    const hex = (v: string | undefined, fallback: string) =>
        v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback
    const sizePreset: Required<QrCardSettings>["qr_size"] =
        s.qr_size === "sm" || s.qr_size === "md" || s.qr_size === "lg" || s.qr_size === "custom"
            ? s.qr_size
            : QR_CARD_DEFAULTS.qr_size
    const sizeCustom = Math.max(30, Math.min(80,
        Number.isFinite(s.qr_size_custom_percent) ? Number(s.qr_size_custom_percent) : QR_CARD_DEFAULTS.qr_size_custom_percent,
    ))
    return {
        show_restaurant_name: s.show_restaurant_name ?? QR_CARD_DEFAULTS.show_restaurant_name,
        show_city: s.show_city ?? QR_CARD_DEFAULTS.show_city,
        show_logo: s.show_logo ?? QR_CARD_DEFAULTS.show_logo,
        header_color_1: hex(s.header_color_1, QR_CARD_DEFAULTS.header_color_1),
        header_color_2: hex(s.header_color_2, QR_CARD_DEFAULTS.header_color_2),
        use_solid_header: s.use_solid_header ?? QR_CARD_DEFAULTS.use_solid_header,
        custom_text: (s.custom_text ?? QR_CARD_DEFAULTS.custom_text).slice(0, 120),
        qr_size: sizePreset,
        qr_size_custom_percent: sizeCustom,
    }
}

/** The footer URL bar uses a darker shade of the header colors. Compute
 *  by mixing each header color with black so the footer always stays
 *  visually anchored to the header even when the admin picks custom
 *  colors. */
export function darkenHex(hex: string, amount = 0.4): string {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
    if (!m) return hex
    const n = parseInt(m[1]!, 16)
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * (1 - amount))))
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 0xff) * (1 - amount))))
    const b = Math.max(0, Math.min(255, Math.round((n & 0xff) * (1 - amount))))
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
}
