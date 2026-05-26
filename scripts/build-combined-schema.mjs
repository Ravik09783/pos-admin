#!/usr/bin/env node
/**
 * Regenerate `supabase/migrations/combined_schema.sql` from the numbered
 * source bundles.
 *
 *     node scripts/build-combined-schema.mjs      (or: npm run db:build-schema)
 *
 * What it does:
 *   1. Backs up the current combined_schema.sql into a dated backup
 *      folder (`_backup_<today>/`) — nothing is overwritten un-snapshotted.
 *   2. Concatenates every `NN_*.sql` bundle from `_backup_2026-05-20/`,
 *      in apply order, each preceded by a SOURCE FILE banner.
 *   3. Writes the merged result back to combined_schema.sql.
 *
 * The bundles in `_backup_2026-05-20/` are the editable source of truth;
 * combined_schema.sql is GENERATED — never hand-edit it directly. To make
 * a schema change: edit the relevant bundle, then run this script.
 */
import fs from "node:fs"
import path from "node:path"

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations")
const BUNDLE_DIR = path.join(MIGRATIONS, "_backup_2026-05-20")
const COMBINED = path.join(MIGRATIONS, "combined_schema.sql")

if (!fs.existsSync(BUNDLE_DIR)) {
    console.error(`✗ Source bundle folder not found: ${BUNDLE_DIR}`)
    console.error(`  Run this from the repo root.`)
    process.exit(1)
}

// ── 1. Collect the numbered bundles, in apply order ──────────────────────
const bundles = fs.readdirSync(BUNDLE_DIR)
    .filter((f) => /^\d\d_.*\.sql$/.test(f))
    .sort()
if (bundles.length === 0) {
    console.error(`✗ No NN_*.sql bundles found in ${BUNDLE_DIR}`)
    process.exit(1)
}

// ── 2. Back up the current combined_schema.sql before overwriting ────────
// The backup keeps its original filename — the dated `_backup_<today>/`
// folder already records WHEN it was taken, so a timestamp in the name
// would be redundant. Re-running on the same day refreshes that day's
// single backup.
const today = new Date().toISOString().slice(0, 10)
const backupDir = path.join(MIGRATIONS, `_backup_${today}`)
if (fs.existsSync(COMBINED)) {
    fs.mkdirSync(backupDir, { recursive: true })
    const dest = path.join(backupDir, "combined_schema.sql")
    fs.copyFileSync(COMBINED, dest)
    console.log(`• backed up previous schema → ${path.relative(process.cwd(), dest)}`)
}

// ── 3. SOURCE FILE banner — 79-column box, matching the existing format ──
function banner(name) {
    const top = "-- ╔" + "═".repeat(74) + "╗"
    const bot = "-- ╚" + "═".repeat(74) + "╝"
    const label = "  SOURCE FILE: " + name
    const mid = "-- ║" + label + " ".repeat(Math.max(0, 74 - label.length)) + "║"
    return [top, mid, bot].join("\n")
}

const count = bundles.length
const header = [
    "-- =============================================================================",
    "-- RestoPOS — COMBINED DATABASE SCHEMA",
    "-- =============================================================================",
    "--",
    `-- This single file is the concatenation of migration bundles 01 through ${String(count).padStart(2, "0")},`,
    "-- in apply order. It exists so a fresh database can be provisioned by pasting",
    `-- ONE file into the Supabase SQL editor instead of ${count} separate runs.`,
    "--",
    `-- Generated: ${today}  (by scripts/build-combined-schema.mjs)`,
    "-- Source bundles: supabase/migrations/_backup_2026-05-20/",
    "--",
    "-- Every bundle is idempotent (CREATE ... IF NOT EXISTS / CREATE OR REPLACE /",
    "-- DROP POLICY IF EXISTS + CREATE), so re-running this whole file on an",
    "-- existing database is safe — later definitions simply overwrite earlier",
    "-- ones exactly as the original ordered migrations did.",
    "--",
    "-- DO NOT hand-edit this file. Edit the source bundle, then regenerate:",
    "--     npm run db:build-schema",
    "-- =============================================================================",
].join("\n")

// ── 4. Concatenate header + every bundle (banner, then raw body) ─────────
let out = header
for (const name of bundles) {
    const body = fs.readFileSync(path.join(BUNDLE_DIR, name), "utf8")
    out += "\n\n\n" + banner(name) + "\n\n" + body
}

fs.writeFileSync(COMBINED, out)
console.log(`✓ merged ${count} bundles → ${path.relative(process.cwd(), COMBINED)}`)
console.log(`  ${out.split("\n").length} lines, ${(Buffer.byteLength(out) / 1024).toFixed(0)} kB`)
