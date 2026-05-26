/**
 * Age in completed years from a YYYY-MM-DD date string. Returns null for
 * missing / unparseable inputs. Deliberately not a hook — pure function so
 * it works in SSR + tests without ceremony.
 */
export function computeAge(dob: string | null | undefined, now: Date = new Date()): number | null {
    if (!dob) return null
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob)
    if (!m) return null
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3])
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
    let age = now.getFullYear() - y
    // Birthday hasn't happened yet this year? → minus one.
    if (now.getMonth() < mo || (now.getMonth() === mo && now.getDate() < d)) age -= 1
    if (age < 0 || age > 150) return null
    return age
}
