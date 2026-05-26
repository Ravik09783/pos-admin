import type { Meta, StoryObj } from "@storybook/react-vite"

/**
 * `PaymentNotifier` renders **null** — it's a pure side-effect component.
 * This story exists as the documentation surface for what it does, since
 * there's nothing to "look at" in a normal sense.
 *
 * Real component: `src/components/app-shell/payment-notifier.tsx`.
 */
function DocPanel() {
    return (
        <div className="max-w-2xl space-y-4 text-sm">
            <h2 className="text-lg font-semibold">PaymentNotifier — side-effect component</h2>
            <p className="text-muted-foreground">
                Mounted once at the root of the authenticated app shell. Renders
                <code className="text-foreground mx-1 px-1 py-0.5 rounded bg-muted">null</code>.
                Subscribes to <code className="text-foreground">payments</code> INSERT
                events via Supabase Realtime (filtered server-side by the active
                branch's <code className="text-foreground">branch_id</code> when set,
                falling back to <code className="text-foreground">tenant_id</code>).
            </p>
            <h3 className="font-semibold">What it does on every paid online order</h3>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Dedupe the inbound row id against a Set ref (StrictMode + multi-delivery safe).</li>
                <li>Skip non-online methods (CASH / counter UPI / card-machine).</li>
                <li>Look up the bill → order chain to confirm <code className="text-foreground">source === &quot;QR&quot;</code>.</li>
                <li>Fire a Sonner toast inside the app.</li>
                <li>Fire a <strong>browser-native notification</strong> with the chime — works even when the tab is in the background.</li>
            </ol>
            <h3 className="font-semibold">Where to see it live</h3>
            <p className="text-muted-foreground">
                Open the dashboard in a multi-branch tenant, switch to a branch
                via the topbar, then place a QR order from another phone and pay.
                The toast + the OS notification fire within ~1 second of the
                webhook landing.
            </p>
            <p className="text-xs text-muted-foreground italic">
                See also: <code>useActiveBranch</code> hook, <code>playOrderChime</code> helper
                ({" "}<code>src/lib/notifications/sound.ts</code>{" "}).
            </p>
        </div>
    )
}

const meta: Meta<typeof DocPanel> = {
    title: "AppShell/PaymentNotifier",
    component: DocPanel,
    tags: ["autodocs"],
    parameters: {
        layout: "padded",
        docs: { description: { component: "Side-effect component (renders null). This story is the documentation surface." } },
    },
}
export default meta
type Story = StoryObj<typeof DocPanel>

export const Documentation: Story = {}
