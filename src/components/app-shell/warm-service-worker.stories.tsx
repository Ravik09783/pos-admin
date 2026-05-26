import type { Meta, StoryObj } from "@storybook/react-vite"

/**
 * `WarmServiceWorker` renders **null**. This story documents what it does.
 * Real component: `src/components/app-shell/warm-service-worker.tsx`.
 */
function DocPanel() {
    return (
        <div className="max-w-2xl space-y-4 text-sm">
            <h2 className="text-lg font-semibold">WarmServiceWorker — auth-gated cache warmup</h2>
            <p className="text-muted-foreground">
                Mounted in <code>(app)/layout.tsx</code>, so it runs only once
                the user has crossed the auth gate. Sends a single
                {" "}<code>{`{ type: "warm" }`}</code> postMessage to the active
                service worker.
            </p>
            <h3 className="font-semibold">Why two-step warmup?</h3>
            <p className="text-muted-foreground">
                The shift-critical pages (POS, KDS, Tables, Bills) are
                <em> behind login</em>. If the SW pre-cached them on first
                install (when the visitor isn't signed in yet), the cache
                would store the <code>/login</code> redirect for{" "}
                <code>/pos</code>. Later, when the user signs in and goes
                offline, the cached redirect would still send them back to
                login — totally broken.
            </p>
            <p className="text-muted-foreground">
                Delaying the warm-up signal until the user has reached the
                authenticated shell guarantees the SW pre-caches the
                <em> real</em> pages, not the login wall.
            </p>
            <h3 className="font-semibold">What the SW does on warm</h3>
            <pre className="text-xs bg-muted/40 p-3 rounded-md overflow-x-auto"><code>{
`self.addEventListener("message", (event) => {
    if (event.data?.type === "warm") {
        event.waitUntil(
            caches.open(RUNTIME_CACHE)
                .then((c) => c.addAll(WARM_ASSETS).catch(() => {}))
        )
    }
})`
}</code></pre>
        </div>
    )
}

const meta: Meta<typeof DocPanel> = {
    title: "AppShell/WarmServiceWorker",
    component: DocPanel,
    tags: ["autodocs"],
    parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj<typeof DocPanel>
export const Documentation: Story = {}
