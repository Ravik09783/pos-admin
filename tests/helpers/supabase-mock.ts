/**
 * Lightweight in-memory Supabase mock for API route tests.
 *
 * The real Supabase client builds queries with a fluent chain
 *   .from('x').select('...').eq('a', 1).maybeSingle()
 * and we recreate just enough of that to drive route handlers in unit tests.
 * Each table holds an array of rows; .from() returns a fresh QueryBuilder that
 * applies filter/order/limit operations lazily on .then() / .maybeSingle() /
 * .insert() / .update() / .delete().
 *
 * Only the subset of features the routes actually use is implemented; calling
 * an unknown method throws so missing coverage is obvious.
 */

export type Row = Record<string, unknown>

interface BuilderState {
    filters: Array<{ col: string; op: "eq" | "in" | "is"; val: unknown }>
    order?: { col: string; ascending: boolean }
    limit?: number
}

export interface MockTableHooks {
    /** Override what an INSERT does (e.g. throw, return a custom row). */
    onInsert?: (row: Row | Row[]) => { data: Row | Row[] | null; error: { message: string } | null }
    /** Override what an UPDATE does. */
    onUpdate?: (changes: Row, state: BuilderState) => { data: Row[] | null; error: { message: string } | null }
}

export class MockSupabase {
    public tables: Record<string, Row[]> = {}
    public hooks: Record<string, MockTableHooks> = {}
    public storage = new MockStorage()
    public rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {}
    public lastInsert: Record<string, Row | Row[]> = {}
    public lastUpdate: Record<string, { changes: Row; matched: Row[] }> = {}

    seed(table: string, rows: Row[]) { this.tables[table] = rows.map((r) => ({ ...r })) }
    setHook(table: string, hooks: MockTableHooks) { this.hooks[table] = hooks }
    setRpc(name: string, fn: (args: Record<string, unknown>) => unknown) { this.rpcs[name] = fn }

    from(table: string): QueryBuilder {
        if (!this.tables[table]) this.tables[table] = []
        return new QueryBuilder(this, table)
    }

    rpc(name: string, args: Record<string, unknown> = {}) {
        const fn = this.rpcs[name]
        if (!fn) return Promise.resolve({ data: null, error: { message: `rpc ${name} not stubbed` } })
        try {
            const data = fn(args)
            return Promise.resolve({ data, error: null })
        } catch (e) {
            return Promise.resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } })
        }
    }
}

class QueryBuilder {
    private state: BuilderState = { filters: [] }
    constructor(private db: MockSupabase, private table: string) {}

    select(_cols?: string, _opts?: { count?: string; head?: boolean }) { return this }
    eq(col: string, val: unknown) { this.state.filters.push({ col, op: "eq", val }); return this }
    in(col: string, vals: unknown[]) { this.state.filters.push({ col, op: "in", val: vals }); return this }
    is(col: string, val: unknown) { this.state.filters.push({ col, op: "is", val }); return this }
    order(col: string, opts: { ascending?: boolean } = {}) {
        this.state.order = { col, ascending: opts.ascending !== false }
        return this
    }
    limit(n: number) { this.state.limit = n; return this }

    private matchedRows(): Row[] {
        let rows = [...(this.db.tables[this.table] ?? [])]
        for (const f of this.state.filters) {
            if (f.op === "eq") rows = rows.filter((r) => r[f.col] === f.val)
            else if (f.op === "in") rows = rows.filter((r) => (f.val as unknown[]).includes(r[f.col]))
            else if (f.op === "is") rows = rows.filter((r) => r[f.col] === f.val)
        }
        if (this.state.order) {
            const { col, ascending } = this.state.order
            rows.sort((a, b) => {
                const av = a[col] as number | string
                const bv = b[col] as number | string
                if (av === bv) return 0
                return (av < bv ? -1 : 1) * (ascending ? 1 : -1)
            })
        }
        if (this.state.limit !== undefined) rows = rows.slice(0, this.state.limit)
        return rows
    }

    async maybeSingle() {
        const rows = this.matchedRows()
        return { data: rows[0] ?? null, error: null }
    }

    // Lets `await builder` work for list queries (no .maybeSingle()).
    then<T>(onFulfilled: (v: { data: Row[] | null; error: null }) => T) {
        return Promise.resolve({ data: this.matchedRows(), error: null }).then(onFulfilled)
    }

    insert(row: Row | Row[]) {
        const hook = this.db.hooks[this.table]?.onInsert
        this.db.lastInsert[this.table] = row
        if (hook) {
            const result = hook(row)
            return new InsertResult(this.db, this.table, result.data, result.error)
        }
        const rowsArr = Array.isArray(row) ? row : [row]
        for (const r of rowsArr) {
            // Auto-fill id if not present
            const inserted = { id: r.id ?? `mock-${Math.random().toString(36).slice(2, 10)}`, ...r }
            this.db.tables[this.table]!.push(inserted)
        }
        const inserted = this.db.tables[this.table]!.slice(-rowsArr.length)
        return new InsertResult(this.db, this.table, Array.isArray(row) ? inserted : (inserted[0] ?? null), null)
    }

    upsert(row: Row, _opts?: { onConflict?: string }) {
        return this.insert(row)
    }

    update(changes: Row) {
        return new UpdateBuilder(this.db, this.table, changes, this.state)
    }

    delete() {
        return new DeleteBuilder(this.db, this.table, this.state)
    }
}

class InsertResult {
    constructor(
        private db: MockSupabase,
        private table: string,
        private data: Row | Row[] | null,
        private error: { message: string } | null,
    ) {}
    select(_cols?: string) { return this }
    async maybeSingle() {
        const d = Array.isArray(this.data) ? (this.data[0] ?? null) : this.data
        return { data: d, error: this.error }
    }
    then<T>(onFulfilled: (v: { data: Row | Row[] | null; error: { message: string } | null }) => T) {
        return Promise.resolve({ data: this.data, error: this.error }).then(onFulfilled)
    }
}

class UpdateBuilder {
    constructor(
        private db: MockSupabase,
        private table: string,
        private changes: Row,
        private state: BuilderState,
    ) {}

    eq(col: string, val: unknown) {
        this.state.filters.push({ col, op: "eq", val })
        return this
    }

    private apply() {
        const hook = this.db.hooks[this.table]?.onUpdate
        const rows = this.db.tables[this.table] ?? []
        const matched: Row[] = []
        for (const r of rows) {
            const ok = this.state.filters.every((f) => {
                if (f.op === "eq") return r[f.col] === f.val
                if (f.op === "in") return (f.val as unknown[]).includes(r[f.col])
                if (f.op === "is") return r[f.col] === f.val
                return false
            })
            if (ok) {
                Object.assign(r, this.changes)
                matched.push(r)
            }
        }
        this.db.lastUpdate[this.table] = { changes: this.changes, matched }
        if (hook) return hook(this.changes, this.state)
        return { data: matched, error: null }
    }

    then<T>(onFulfilled: (v: { data: Row[] | null; error: { message: string } | null }) => T) {
        const r = this.apply()
        return Promise.resolve(r).then(onFulfilled)
    }
}

class DeleteBuilder {
    constructor(
        private db: MockSupabase,
        private table: string,
        private state: BuilderState,
    ) {}
    eq(col: string, val: unknown) {
        this.state.filters.push({ col, op: "eq", val })
        return this
    }
    then<T>(onFulfilled: (v: { data: null; error: null }) => T) {
        const rows = this.db.tables[this.table] ?? []
        this.db.tables[this.table] = rows.filter((r) => {
            return !this.state.filters.every((f) => {
                if (f.op === "eq") return r[f.col] === f.val
                return false
            })
        })
        return Promise.resolve({ data: null, error: null }).then(onFulfilled)
    }
}

class MockStorage {
    private uploads: Array<{ bucket: string; path: string; size: number }> = []
    from(bucket: string) {
        return {
            upload: async (path: string, body: ArrayBuffer | Buffer, _opts?: unknown) => {
                const size = body instanceof Buffer ? body.length : (body as ArrayBuffer).byteLength
                this.uploads.push({ bucket, path, size })
                return { data: { path }, error: null }
            },
            getPublicUrl: (path: string) => ({
                data: { publicUrl: `https://storage.test/${bucket}/${path}` },
            }),
        }
    }
    list(bucket?: string) {
        return bucket ? this.uploads.filter((u) => u.bucket === bucket) : this.uploads
    }
}
