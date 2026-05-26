import type { StorybookConfig } from "@storybook/nextjs-vite"

/**
 * Storybook 9 config. Vite-based for fast dev startup; reads stories from
 * anywhere under `src/` so a `Component.stories.tsx` lives next to its
 * `Component.tsx` (the simplest possible convention).
 *
 * Why Vite (not webpack): faster cold start, no second webpack config to
 * keep in sync with Next's, and Storybook 9's Vite framework has first-
 * class Next.js support (next/image, next/router, `@/*` path alias).
 */
const config: StorybookConfig = {
    stories: ["../src/**/*.stories.@(ts|tsx)"],
    addons: [
        "@storybook/addon-themes",
        // Required for autodocs: ships the `Description` / `Stories` /
        // `ArgsTable` blocks that fill the Docs page. Without it, clicking
        // a "Docs" entry mounts an empty container — which on our dark
        // `bg-background` body looked like a black screen.
        "@storybook/addon-docs",
    ],
    framework: {
        name: "@storybook/nextjs-vite",
        options: {},
    },
    docs: {
        autodocs: "tag",
    },
    // Make sure Storybook's Vite picks up the same TS path alias Next does.
    async viteFinal(viteConfig) {
        viteConfig.resolve = viteConfig.resolve ?? {}
        viteConfig.resolve.alias = {
            ...(viteConfig.resolve.alias as Record<string, string> | undefined),
            "@": new URL("../src", import.meta.url).pathname,
        }
        // Provide safe placeholders for the Supabase env vars so components
        // that import `createClient()` at module load don't crash when a
        // developer opens Storybook on a fresh clone with no `.env.local`.
        viteConfig.define = {
            ...(viteConfig.define ?? {}),
            "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(
                process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
            ),
            "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key-not-used-in-storybook",
            ),
        }
        return viteConfig
    },
}

export default config
