"use client"

/**
 * Drop-in image uploader: click to pick, drag-and-drop, auto-compress,
 * upload to Supabase Storage, return the public URL. Shows the current
 * image (or a placeholder) and a remove button.
 *
 * Designed to be used as a form-control replacement — the host owns the
 * URL state and we just call onChange with the new value (or null on
 * remove).
 */

import { useRef, useState } from "react"
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { compressAndUpload } from "@/lib/storage/image-upload"
import { cn } from "@/lib/utils"

export interface ImageUploaderProps {
    /** Current image URL (controlled). */
    value: string | null | undefined
    onChange: (url: string | null) => void
    /** Which storage bucket + which path to write to. The host generates the
     *  path with `tenantImagePath()` so we keep tenant_id in the prefix. */
    bucket: "menu-images" | "tenant-logos" | "user-avatars"
    /** Tenant-scoped object key (must begin with the tenant_id). */
    path: string
    /** Visual variant: square (avatar / menu item) or wide (cover). */
    aspect?: "square" | "wide"
    /** Pixel size for the square variant (default 96). */
    size?: number
    label?: string
    hint?: string
    /** Disable interaction. */
    disabled?: boolean
    /** Max file size in MB before we refuse (defaults to 10). */
    maxMB?: number
}

export function ImageUploader({
    value,
    onChange,
    bucket,
    path,
    aspect = "square",
    size = 96,
    label,
    hint,
    disabled,
    maxMB = 10,
}: ImageUploaderProps) {
    const supabase = createClient()
    const fileInput = useRef<HTMLInputElement | null>(null)
    const [busy, setBusy] = useState(false)
    const [dragOver, setDragOver] = useState(false)

    async function handleFile(file: File) {
        if (!/^image\//.test(file.type)) {
            toast.error("Please pick an image file")
            return
        }
        if (file.size > maxMB * 1024 * 1024) {
            toast.error(`Image is too large — keep it under ${maxMB} MB`)
            return
        }
        setBusy(true)
        try {
            const r = await compressAndUpload(supabase, file, { bucket, path })
            onChange(r.publicUrl)
            if (r.compression && r.compression.savedBytes > 5000) {
                const savedKB = Math.round(r.compression.savedBytes / 1024)
                toast.success(`Image uploaded — saved ${savedKB} KB by compressing`)
            } else {
                toast.success("Image uploaded")
            }
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Upload failed")
        } finally {
            setBusy(false)
        }
    }

    function pick() { fileInput.current?.click() }

    return (
        <div className="space-y-1.5">
            {label && <div className="text-sm font-medium">{label}</div>}
            <div
                onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    if (disabled) return
                    const f = e.dataTransfer.files?.[0]
                    if (f) handleFile(f)
                }}
                className={cn(
                    "relative rounded-lg border-2 border-dashed transition-colors overflow-hidden",
                    dragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40",
                    disabled && "opacity-50 cursor-not-allowed",
                    aspect === "wide" ? "aspect-[3/2]" : "",
                )}
                style={aspect === "square" ? { width: size, height: size } : undefined}
            >
                {value ? (
                    <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={value} alt="" className="h-full w-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                            <Button size="icon" variant="secondary" className="h-7 w-7" onClick={pick} disabled={disabled || busy} title="Replace">
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                            </Button>
                            <Button size="icon" variant="destructive" className="h-7 w-7" onClick={() => onChange(null)} disabled={disabled || busy} title="Remove">
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={pick}
                        disabled={disabled || busy}
                        className="h-full w-full flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
                    >
                        {busy
                            ? <Loader2 className="h-5 w-5 animate-spin" />
                            : <ImageIcon className="h-5 w-5" />}
                        <span className="text-[10px]">{busy ? "Uploading…" : "Add image"}</span>
                    </button>
                )}
            </div>
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
            <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                    // reset so picking the same file twice still fires
                    e.target.value = ""
                }}
            />
        </div>
    )
}
