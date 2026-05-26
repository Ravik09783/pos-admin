import type { Meta, StoryObj } from "@storybook/react-vite"
import { Check, ChevronDown, LogOut, Settings, User } from "lucide-react"

import { Button } from "./button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "./dropdown-menu"

const meta = {
    title: "UI/DropdownMenu",
    component: DropdownMenu,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Radix-backed dropdown menu primitive. Used for the user menu in the topbar, the branch switcher, the inline status pickers on the Tables page, etc. Compose: `<DropdownMenu>` → `<DropdownMenuTrigger asChild>` → `<DropdownMenuContent>` → items.",
            },
        },
    },
} satisfies Meta<typeof DropdownMenu>
export default meta
type Story = StoryObj<typeof meta>

/** Typical user menu — name label, separator, then actions. */
export const UserMenu: Story = {
    render: () => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                    <User className="h-4 w-4" /> Karan Sharma <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">karan@spicegarden.in</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem><Settings className="h-4 w-4 mr-2" /> Settings</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive">
                    <LogOut className="h-4 w-4 mr-2" /> Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    ),
}

/** Branch picker style — checked item gets a Check icon in the gutter. */
export const PickerWithChecks: Story = {
    render: () => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">Bandra Kurla Complex <ChevronDown className="h-3 w-3 opacity-60" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Switch branch</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2"><span className="h-4 w-4" /> Connaught Place</DropdownMenuItem>
                <DropdownMenuItem className="gap-2 text-primary">
                    <Check className="h-3.5 w-3.5" /> Bandra Kurla Complex
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2"><span className="h-4 w-4" /> Indiranagar</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    ),
}
