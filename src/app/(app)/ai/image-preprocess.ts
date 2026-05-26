/**
 * Browser-side image preprocessing for the OCR pipeline.
 *
 * Three jobs:
 *   1. **Grayscale** — drops colour noise that confuses Tesseract
 *      (the worst offender is a yellow / orange menu background where
 *      the bare RGB values fall well outside the model's assumed
 *      black-text-on-white-paper distribution).
 *   2. **Contrast boost** — linear stretch around 128 so the
 *      remaining ink lifts away from the paper grey. This is what
 *      saves a "₹150" that the camera flash washed into "₹15O".
 *   3. **Column split** — slice the canvas into N vertical strips
 *      and hand each one to Tesseract on its own. Without this,
 *      a two-column menu has "SNACKS" (left col header) and "SUBZ
 *      BAHAR" (right col header) merged onto the same OCR line.
 *
 * Pure canvas. No deps. The output is a list of Blobs ready to be
 * passed to a Tesseract worker.
 */

export interface PreprocessOptions {
    /** 1 = single-column (default), 2 = side-by-side, 3 = three columns. */
    columns: 1 | 2 | 3
    /** Contrast multiplier. 1 = unchanged, 1.5 = boosted (default). */
    contrast?: number
    /** Whether to apply grayscale. Defaults to true. */
    grayscale?: boolean
}

/** Loads a File into an HTMLImageElement, awaiting decode. */
function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
        img.src = url
    })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
            if (b) resolve(b)
            else reject(new Error("Couldn't encode the preprocessed image"))
            // PNG keeps text edges crisp; JPEG would soften them and
            // hurt OCR. The size hit is fine for a one-shot upload.
        }, "image/png")
    })
}

/** Apply grayscale + contrast in-place on the canvas pixel buffer. */
function applyGrayscaleAndContrast(ctx: CanvasRenderingContext2D, w: number, h: number, contrast: number, grayscale: boolean) {
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    // Contrast formula: y = ((x - 128) * c) + 128, clamped.
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!
        const g = data[i + 1]!
        const b = data[i + 2]!
        // Luminance grayscale (closer to perceived brightness than a
        // plain average — keeps red text on yellow paper legible).
        const gray = grayscale ? (0.299 * r + 0.587 * g + 0.114 * b) : (r + g + b) / 3
        const adj = (gray - 128) * contrast + 128
        const v = adj < 0 ? 0 : adj > 255 ? 255 : adj
        data[i] = v
        data[i + 1] = v
        data[i + 2] = v
        // alpha untouched
    }
    ctx.putImageData(imageData, 0, 0)
}

/**
 * Main entry. Given a File, returns a Blob per column — already
 * grayscaled + contrast-boosted, ready to OCR.
 */
/** Tesseract gives best results when text x-height is ~30 px. A
 *  typical menu photo at 1000 px wide has text around 15 px — so
 *  we upscale anything under ~1500 px to give Tesseract more pixels
 *  to chew on. Larger sources are left at native resolution
 *  (upscaling further would just blur). */
const TARGET_MIN_WIDTH = 1500

export async function preprocessForOcr(
    file: File,
    options: PreprocessOptions,
): Promise<Blob[]> {
    const { columns, contrast = 1.7, grayscale = true } = options
    const img = await loadImage(file)
    const sourceW = img.naturalWidth
    const sourceH = img.naturalHeight
    if (sourceW === 0 || sourceH === 0) throw new Error("Image has zero dimensions")

    // Decide the working size — upscale low-res sources, keep big ones
    // alone. The smoothing flags below give a smoother bicubic-ish
    // upscale, which Tesseract handles much better than a hard nearest-
    // neighbour blow-up.
    const scale = sourceW < TARGET_MIN_WIDTH ? TARGET_MIN_WIDTH / sourceW : 1
    const w = Math.round(sourceW * scale)
    const h = Math.round(sourceH * scale)

    const base = document.createElement("canvas")
    base.width = w
    base.height = h
    const baseCtx = base.getContext("2d", { willReadFrequently: true })
    if (!baseCtx) throw new Error("Couldn't get a 2D canvas context")
    baseCtx.imageSmoothingEnabled = true
    baseCtx.imageSmoothingQuality = "high"
    baseCtx.drawImage(img, 0, 0, w, h)
    applyGrayscaleAndContrast(baseCtx, w, h, contrast, grayscale)

    if (columns === 1) return [await canvasToBlob(base)]

    // Split vertically. We add a 12-px overlap between columns so a
    // dish name centred on the column gutter doesn't get its first
    // letter shaved off — Tesseract will still read it once in each
    // column; the parser de-dupes downstream.
    const overlap = 12
    const colWidth = Math.floor(w / columns)
    const blobs: Blob[] = []
    for (let i = 0; i < columns; i++) {
        const sx = i === 0 ? 0 : Math.max(0, i * colWidth - overlap)
        const sw = Math.min(w - sx, colWidth + (i === 0 ? overlap : overlap * 2))
        const colCanvas = document.createElement("canvas")
        colCanvas.width = sw
        colCanvas.height = h
        const colCtx = colCanvas.getContext("2d")
        if (!colCtx) continue
        colCtx.drawImage(base, sx, 0, sw, h, 0, 0, sw, h)
        blobs.push(await canvasToBlob(colCanvas))
    }
    return blobs
}
