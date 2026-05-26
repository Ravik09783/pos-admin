/**
 * Generates a unique Supabase Realtime channel name.
 *
 * Why: a Supabase channel can only have `postgres_changes` callbacks added
 * BEFORE `.subscribe()`. If you reuse a channel name, `supabase.channel(name)`
 * returns the existing (already-subscribed) instance, and the next `.on(...)`
 * throws "cannot add postgres_changes callbacks for realtime:<name> after
 * subscribe()". This happens whenever:
 *   - the same hook is mounted twice (e.g. desktop sidebar + mobile sheet),
 *   - React StrictMode double-mounts a component in dev,
 *   - a `useEffect` re-runs because a dependency changed faster than the
 *     previous channel finished tearing down.
 *
 * Suffixing with a module-level counter sidesteps all of these — every
 * subscription gets its own channel, and `removeChannel` on cleanup is enough.
 */
let seq = 0

export function uniqueChannelName(base: string): string {
    return `${base}-${++seq}`
}
