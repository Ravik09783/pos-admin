// import type { Config } from "tailwindcss"

// const config: Config = {
//     darkMode: "class",
//     content: [
//         "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
//         "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
//         "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
//     ],
//     theme: {
//         container: {
//             center: true,
//             padding: "1.5rem",
//             screens: { "2xl": "1400px" },
//         },
//         extend: {
//             fontFamily: {
//                 // DM Sans is the primary UI typeface — friendly, geometric,
//                 // legible at all sizes. The `var(--font-dm-sans)` variable is
//                 // wired up by next/font/google in src/app/layout.tsx.
//                 sans: ["var(--font-dm-sans)", "ui-sans-serif", "system-ui"],
//                 // Lora is reserved for headings — a humanist serif with
//                 // restaurant-menu warmth that pairs well with DM Sans.
//                 serif: ["var(--font-lora)", "Georgia", "serif"],
//                 heading: ["var(--font-lora)", "Georgia", "serif"],
//                 mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
//             },
//             colors: {
//                 border: "hsl(var(--border))",
//                 input: "hsl(var(--input))",
//                 ring: "hsl(var(--ring))",
//                 background: "hsl(var(--background))",
//                 foreground: "hsl(var(--foreground))",
//                 primary: {
//                     DEFAULT: "hsl(var(--primary))",
//                     foreground: "hsl(var(--primary-foreground))",
//                 },
//                 secondary: {
//                     DEFAULT: "hsl(var(--secondary))",
//                     foreground: "hsl(var(--secondary-foreground))",
//                 },
//                 destructive: {
//                     DEFAULT: "hsl(var(--destructive))",
//                     foreground: "hsl(var(--destructive-foreground))",
//                 },
//                 success: {
//                     DEFAULT: "hsl(var(--success))",
//                     foreground: "hsl(var(--success-foreground))",
//                 },
//                 warning: {
//                     DEFAULT: "hsl(var(--warning))",
//                     foreground: "hsl(var(--warning-foreground))",
//                 },
//                 muted: {
//                     DEFAULT: "hsl(var(--muted))",
//                     foreground: "hsl(var(--muted-foreground))",
//                 },
//                 accent: {
//                     DEFAULT: "hsl(var(--accent))",
//                     foreground: "hsl(var(--accent-foreground))",
//                 },
//                 popover: {
//                     DEFAULT: "hsl(var(--popover))",
//                     foreground: "hsl(var(--popover-foreground))",
//                 },
//                 card: {
//                     DEFAULT: "hsl(var(--card))",
//                     foreground: "hsl(var(--card-foreground))",
//                 },
//                 neon: {
//                     cyan: "hsl(var(--neon-cyan))",
//                     magenta: "hsl(var(--neon-magenta))",
//                     lime: "hsl(var(--neon-lime))",
//                     amber: "hsl(var(--neon-amber))",
//                 },
//             },
//             borderRadius: {
//                 lg: "var(--radius)",
//                 md: "calc(var(--radius) - 2px)",
//                 sm: "calc(var(--radius) - 4px)",
//             },
//             backgroundImage: {
//                 "grid-fade":
//                     "radial-gradient(ellipse at top, hsl(var(--neon-cyan)/0.08), transparent 60%), radial-gradient(ellipse at bottom right, hsl(var(--neon-magenta)/0.06), transparent 50%)",
//             },
//             boxShadow: {
//                 glow: "0 0 0 1px hsl(var(--border)), 0 8px 30px -8px hsl(var(--neon-cyan)/0.25)",
//                 "glow-lg":
//                     "0 0 0 1px hsl(var(--border)), 0 16px 60px -12px hsl(var(--neon-cyan)/0.35)",
//             },
//             keyframes: {
//                 "accordion-down": {
//                     from: { height: "0" },
//                     to: { height: "var(--radix-accordion-content-height)" },
//                 },
//                 "accordion-up": {
//                     from: { height: "var(--radix-accordion-content-height)" },
//                     to: { height: "0" },
//                 },
//                 shimmer: {
//                     "0%": { backgroundPosition: "-200% 0" },
//                     "100%": { backgroundPosition: "200% 0" },
//                 },
//                 pulse_glow: {
//                     "0%, 100%": { boxShadow: "0 0 0 0 hsl(var(--neon-cyan)/0.45)" },
//                     "50%": { boxShadow: "0 0 0 8px hsl(var(--neon-cyan)/0)" },
//                 },
//             },
//             animation: {
//                 "accordion-down": "accordion-down 0.2s ease-out",
//                 "accordion-up": "accordion-up 0.2s ease-out",
//                 shimmer: "shimmer 2.4s linear infinite",
//                 "pulse-glow": "pulse_glow 2s ease-in-out infinite",
//             },
//         },
//     },
//     plugins: [require("tailwindcss-animate")],
// }

// export default config







import type { Config } from "tailwindcss"
import tailwindcssAnimate from "tailwindcss-animate"

const config: Config = {
    darkMode: "class",
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        container: {
            center: true,
            padding: "1.5rem",
            screens: { "2xl": "1400px" },
        },
        extend: {
            fontFamily: {
                sans: ["var(--font-dm-sans)", "ui-sans-serif", "system-ui"],
                // `heading` is DM Sans too — the UI has no serif. `serif`
                // stays a real serif because it's an opt-in BILL-template
                // font (cafés / fine-dining receipts), not app chrome.
                heading: ["var(--font-dm-sans)", "ui-sans-serif", "system-ui"],
                serif: ["var(--font-lora)", "Georgia", "serif"],
                mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
            },
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                success: {
                    DEFAULT: "hsl(var(--success))",
                    foreground: "hsl(var(--success-foreground))",
                },
                warning: {
                    DEFAULT: "hsl(var(--warning))",
                    foreground: "hsl(var(--warning-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                neon: {
                    cyan: "hsl(var(--neon-cyan))",
                    magenta: "hsl(var(--neon-magenta))",
                    lime: "hsl(var(--neon-lime))",
                    amber: "hsl(var(--neon-amber))",
                },
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            backgroundImage: {
                "grid-fade":
                    "radial-gradient(ellipse at top, hsl(var(--neon-cyan)/0.08), transparent 60%), radial-gradient(ellipse at bottom right, hsl(var(--neon-magenta)/0.06), transparent 50%)",
            },
            boxShadow: {
                // `shadow-glow` / `shadow-glow-lg` used to project a
                // cyan halo to give cards / CTAs a "neon" feel. The
                // new design system is gradient + glow free — both
                // utilities now resolve to a clean hairline border
                // plus a low-tone neutral drop shadow so the surface
                // still lifts off the background.
                glow: "0 0 0 1px hsl(var(--border)), 0 1px 3px 0 hsl(0 0% 0% / 0.06)",
                "glow-lg": "0 0 0 1px hsl(var(--border)), 0 6px 16px -4px hsl(0 0% 0% / 0.08)",
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
                shimmer: {
                    "0%": { backgroundPosition: "-200% 0" },
                    "100%": { backgroundPosition: "200% 0" },
                },
                pulse_glow: {
                    "0%, 100%": { boxShadow: "0 0 0 0 hsl(var(--neon-cyan)/0.45)" },
                    "50%": { boxShadow: "0 0 0 8px hsl(var(--neon-cyan)/0)" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                shimmer: "shimmer 2.4s linear infinite",
                "pulse-glow": "pulse_glow 2s ease-in-out infinite",
            },
        },
    },
    plugins: [tailwindcssAnimate],
}

export default config
