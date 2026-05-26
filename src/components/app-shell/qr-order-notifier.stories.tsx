import type { Meta, StoryObj } from "@storybook/react-vite"

/**
 * `QrOrderNotifier` renders **null**. This story documents what it does.
 * Real component: `src/components/app-shell/qr-order-notifier.tsx`.
 */
function DocPanel() {
    return (
        <div className="max-w-2xl space-y-4 text-sm">
            <h2 className="text-lg font-semibold">QrOrderNotifier — side-effect component</h2>
            <p className="text-muted-foreground">
                Mounted in the authenticated shell alongside <code>PaymentNotifier</code>.
                Listens for new QR orders the moment a customer hits &ldquo;Place order&rdquo;
                (before payment even captures) so staff have eyes-on the queue
                immediately, not just when money lands.
            </p>
            <h3 className="font-semibold">Trigger</h3>
            <p className="text-muted-foreground">
                Supabase Realtime INSERT on <code>orders</code> with
                <code> source = &lsquo;QR&rsquo; AND awaiting_confirmation = true</code>.
            </p>
            <h3 className="font-semibold">Side effects</h3>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Plays the chime via <code>playOrderChime()</code>.</li>
                <li>Fires a Sonner toast with the customer name + table number.</li>
                <li>Updates the <code>QR pending</code> sidebar badge automatically (via <code>usePendingCount</code>).</li>
            </ol>
            <h3 className="font-semibold">Why two notifiers?</h3>
            <p className="text-muted-foreground">
                <code>QrOrderNotifier</code> fires on <em>place order</em> (intent).
                <code>PaymentNotifier</code> fires on <em>payment captured</em> (commit).
                Staff want both signals — the first so they can keep an eye out,
                the second to actually start cooking.
            </p>
        </div>
    )
}

const meta: Meta<typeof DocPanel> = {
    title: "AppShell/QrOrderNotifier",
    component: DocPanel,
    tags: ["autodocs"],
    parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj<typeof DocPanel>
export const Documentation: Story = {}
