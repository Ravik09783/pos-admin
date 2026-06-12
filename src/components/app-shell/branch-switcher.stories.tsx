import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { BranchSwitcherView } from "./branch-switcher"
import type { Branch } from "@/types/database"

const branch = (id: string, name: string, is_main = false): Branch => ({
    id,
    tenant_id: "t1",
    name,
    code: name.slice(0, 3).toUpperCase(),
    is_main,
    is_active: true,
    address_line1: null,
    city: null,
    state: null,
    state_code: null,
    pincode: null,
    phone: null,
    email: null,
    latitude: null,
    longitude: null,
    geofence_radius_m: 50,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
})

const meta = {
    title: "AppShell/BranchSwitcher",
    component: BranchSwitcherView,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "The topbar **branch switcher** for multi-outlet tenants. One global control drives which branch every list page / dashboard widget / POS menu scopes to. Auto-hides when there's only one branch or when the signed-in user isn't OWNER/MANAGER.",
            },
        },
    },
} satisfies Meta<typeof BranchSwitcherView>
export default meta
type Story = StoryObj<typeof meta>

const THREE_BRANCHES: Branch[] = [
    branch("b1", "Connaught Place", true),
    branch("b2", "Bandra Kurla Complex"),
    branch("b3", "Indiranagar"),
]

/** Most common state — admin viewing one specific branch's data. */
export const SpecificBranchActive: Story = {
    args: {
        activeBranchId: "b2",
        branches: THREE_BRANCHES,
        canSwitch: true,
        onSelect: () => {},
    },
}

/** Aggregate view across every outlet (cross-branch reports). */
export const AllBranchesActive: Story = {
    args: {
        activeBranchId: null,
        branches: THREE_BRANCHES,
        canSwitch: true,
        onSelect: () => {},
    },
}

/** Two branches — minimum required for the switcher to appear at all. */
export const TwoBranches: Story = {
    args: {
        activeBranchId: "b1",
        branches: THREE_BRANCHES.slice(0, 2),
        canSwitch: true,
        onSelect: () => {},
    },
}

/** Single-branch tenant — switcher renders nothing (component returns null). */
export const SingleBranchHidden: Story = {
    args: {
        activeBranchId: "b1",
        branches: [branch("b1", "Main", true)],
        canSwitch: true,
        onSelect: () => {},
    },
    parameters: {
        docs: { description: { story: "Rendered as null. A 1-branch tenant has nothing to switch between." } },
    },
}

/** Non-admin role — switcher hidden even when 2+ branches exist. */
export const NonAdminHidden: Story = {
    args: {
        activeBranchId: "b1",
        branches: THREE_BRANCHES,
        canSwitch: false,
        onSelect: () => {},
    },
    parameters: {
        docs: { description: { story: "Rendered as null. Cashiers/captains are locked to the branch the OWNER assigned them on the Staff page." } },
    },
}

/** Interactive — clicking actually changes the active branch. */
export const Interactive: Story = {
    args: {
        activeBranchId: "b1",
        branches: THREE_BRANCHES,
        canSwitch: true,
        onSelect: () => {},
    },
    render: () => {
        const [active, setActive] = useState<string | null>("b1")
        return (
            <div className="flex flex-col items-start gap-3">
                <BranchSwitcherView
                    activeBranchId={active}
                    branches={THREE_BRANCHES}
                    canSwitch={true}
                    onSelect={setActive}
                />
                <div className="text-xs text-muted-foreground">
                    Active branch id: <span className="font-mono">{active ?? "null (all)"}</span>
                </div>
            </div>
        )
    },
}
