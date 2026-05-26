import type { Meta, StoryObj } from "@storybook/react-vite"
import { Loader2 } from "lucide-react"

import { Button } from "./button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog"
import { Input } from "./input"
import { Label } from "./label"

const meta = {
    title: "UI/Dialog",
    component: Dialog,
    tags: ["autodocs"],
} satisfies Meta<typeof Dialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    render: () => (
        <Dialog>
            <DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit profile</DialogTitle>
                    <DialogDescription>Make changes here. They&apos;ll apply across the app.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="space-y-1.5">
                        <Label>Full name</Label>
                        <Input defaultValue="Aanya Kapoor" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost">Cancel</Button>
                    <Button variant="neon">Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    ),
}

export const Destructive: Story = {
    render: () => (
        <Dialog>
            <DialogTrigger asChild><Button variant="destructive">Void bill</Button></DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Void bill INV-2025-26-00042?</DialogTitle>
                    <DialogDescription>This is permanent. The audit trail is preserved.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="ghost">Cancel</Button>
                    <Button variant="destructive">
                        <Loader2 className="h-4 w-4 animate-spin" /> Voiding…
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    ),
}
