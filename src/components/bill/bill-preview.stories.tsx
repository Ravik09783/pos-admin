import type { Meta, StoryObj } from "@storybook/react-vite"

import { BILL_TEMPLATES, DEFAULT_DESIGN, getTemplate, type BillLayout } from "@/lib/bill/templates"

import { BillPreview } from "./bill-preview"

const sampleTenant = {
    name: "Spice Garden Bistro",
    address_line1: "12 MG Road",
    city: "Bengaluru",
    pincode: "560001",
    phone: "+91 99000 11122",
    gstin: "29ABCDE1234F1Z5",
    fssai: "12345678901234",
    country: "India",
    logo_url: null,
}

const meta = {
    title: "Bill/BillPreview",
    component: BillPreview,
    tags: ["autodocs"],
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Renders a complete printed bill from a `BillDesign` config. Used three ways: (1) the Bill Designer's live preview (sample bill auto-built), (2) the public verified-bill page, (3) the in-app bill detail / print. Six layouts: thermal-classic, thermal-modern, qsr-token, invoice-a4, invoice-grid, card-boutique.",
            },
        },
    },
} satisfies Meta<typeof BillPreview>
export default meta
type Story = StoryObj<typeof meta>

export const ThermalClassic: Story = {
    args: { design: DEFAULT_DESIGN, tenant: sampleTenant },
}

export const ThermalModern: Story = {
    args: {
        design: { ...DEFAULT_DESIGN, layout: "thermal-modern", font: "sans" },
        tenant: sampleTenant,
    },
}

export const InvoiceA4: Story = {
    args: {
        design: { ...DEFAULT_DESIGN, layout: "invoice-a4", width: "A4", font: "sans" },
        tenant: sampleTenant,
    },
}

export const BoutiqueCard: Story = {
    args: {
        design: { ...DEFAULT_DESIGN, layout: "card-boutique", font: "serif", density: "roomy", show_serial: false },
        tenant: sampleTenant,
    },
}

export const QsrToken: Story = {
    args: {
        design: { ...DEFAULT_DESIGN, layout: "qsr-token", show_serial: false, accent_color: "#dc2626" },
        tenant: sampleTenant,
    },
}

/** Walks every layout side-by-side. Useful for picking a template + the
 *  designer's "preview the catalog" surface. */
export const AllLayouts: Story = {
    args: { design: DEFAULT_DESIGN, tenant: sampleTenant },
    parameters: { layout: "fullscreen", docs: { source: { state: "open" } } },
    render: () => {
        const layouts: BillLayout[] = [
            "thermal-classic", "thermal-modern", "invoice-a4",
            "invoice-grid", "card-boutique", "qsr-token",
        ]
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-6">
                {layouts.map((l) => (
                    <div key={l} className="space-y-1.5">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">{l}</div>
                        <BillPreview
                            design={{ ...DEFAULT_DESIGN, layout: l, font: l === "card-boutique" ? "serif" : DEFAULT_DESIGN.font }}
                            tenant={sampleTenant}
                            className="border border-border/40"
                        />
                    </div>
                ))}
            </div>
        )
    },
}

/** Specific named templates from the catalog. */
export const IndiaGstThermal: Story = {
    args: {
        design: getTemplate("in-gst-thermal")?.design ?? DEFAULT_DESIGN,
        tenant: sampleTenant,
    },
}
export const UkVatReceipt: Story = {
    args: {
        design: getTemplate("uk-vat-receipt")?.design ?? DEFAULT_DESIGN,
        tenant: { ...sampleTenant, country: "United Kingdom", gstin: "GB123456789", fssai: null },
    },
}
export const GulfBilingualVat: Story = {
    args: {
        design: getTemplate("gulf-bilingual-vat")?.design ?? DEFAULT_DESIGN,
        tenant: { ...sampleTenant, country: "United Arab Emirates", gstin: "100123456700003", fssai: null },
    },
}

export const TemplateCount: Story = {
    args: { design: DEFAULT_DESIGN, tenant: sampleTenant },
    parameters: { layout: "centered" },
    name: "(Catalog size)",
    render: () => (
        <div className="text-sm text-muted-foreground p-6 text-center max-w-md">
            <p className="font-semibold text-foreground">
                {BILL_TEMPLATES.length} bill formats ship with RestoPOS.
            </p>
            <p className="mt-2 text-xs">
                See the other stories for the six core layouts + India / UK / Gulf country-specific designs.
                Each format is a named preset of <code className="text-foreground">BillDesign</code> + region metadata.
            </p>
        </div>
    ),
}
