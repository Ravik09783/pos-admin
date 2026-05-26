import type { Meta, StoryObj } from "@storybook/react-vite"

/**
 * `SwRegister` renders **null**. This story documents what it does.
 * Real component: `src/components/app-shell/sw-register.tsx`.
 */
function DocPanel() {
    return (
        <div className="max-w-2xl space-y-4 text-sm">
            <h2 className="text-lg font-semibold">SwRegister — service-worker bootstrap</h2>
            <p className="text-muted-foreground">
                Mounted once at the root layout. On mount, calls{" "}
                <code>navigator.serviceWorker.register(&quot;/sw.js&quot;)</code> so
                the PWA service worker takes over fetch + push handling.
            </p>
            <h3 className="font-semibold">What the service worker does</h3>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Cache-first for static next assets (fonts, icons, JS chunks).</li>
                <li>Network-first with offline fallback for HTML pages.</li>
                <li>Receives <code>push</code> events from VAPID-signed Web Push messages and shows OS notifications.</li>
                <li>Handles <code>notificationclick</code> — focuses an existing tab and navigates to the bill detail.</li>
            </ul>
            <h3 className="font-semibold">Why a separate component?</h3>
            <p className="text-muted-foreground">
                Browser SW registration must happen client-side after first
                render. Wrapping it in a tiny <code>&quot;use client&quot;</code>{" "}
                component keeps the root layout a server component.
            </p>
            <p className="text-xs text-muted-foreground italic">
                Sibling: <code>WarmServiceWorker</code> sends the SW a
                <code> warm</code> postMessage once the user reaches the
                authenticated app shell, prompting it to pre-cache shift pages.
            </p>
        </div>
    )
}

const meta: Meta<typeof DocPanel> = {
    title: "AppShell/SwRegister",
    component: DocPanel,
    tags: ["autodocs"],
    parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj<typeof DocPanel>
export const Documentation: Story = {}
