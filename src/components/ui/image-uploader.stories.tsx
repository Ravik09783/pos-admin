import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { ImageUploader } from "./image-uploader"

const meta: Meta<typeof ImageUploader> = {
    title: "UI/ImageUploader",
    component: ImageUploader,
    tags: ["autodocs"],
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Click-or-drag image picker that auto-compresses (max-1600px JPEG via canvas), uploads to Supabase Storage, and hands the host the public URL. Used for menu-item images, category icons, tenant logo, staff avatars. **Upload calls fail in Storybook** (no Supabase) but the empty + filled states render correctly.",
            },
        },
    },
}
export default meta
type Story = StoryObj<typeof ImageUploader>

function Demo({
    initial, aspect = "square", size = 96, label = "Photo",
}: { initial?: string | null; aspect?: "square" | "wide"; size?: number; label?: string }) {
    const [url, setUrl] = useState<string | null>(initial ?? null)
    return (
        <ImageUploader
            value={url}
            onChange={setUrl}
            bucket="menu-images"
            path="story/example.jpg"
            aspect={aspect}
            size={size}
            label={label}
            hint="JPG or PNG, up to 10 MB. Compressed client-side."
        />
    )
}

/** Empty state — placeholder + upload prompt. */
export const Empty: Story = {
    render: () => <Demo />,
}

/** Pre-filled with an image. */
export const Filled: Story = {
    render: () => (
        <Demo initial="https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&q=80" />
    ),
}

/** Wide aspect (cover image) — used for tenant logos. */
export const Wide: Story = {
    render: () => <Demo aspect="wide" label="Cover image" />,
}

/** Larger size — used in profile/staff pages. */
export const Large: Story = {
    render: () => <Demo size={140} label="Avatar" />,
}
