import { PermissionGuard } from "@/components/auth/permission-guard"
import { AuditLogClient } from "./audit-log-client"

/**
 * /audit-log — owner / manager / auditor view of every bill change.
 *
 * The data already exists: `bill_audit_log` is append-only at the DB level
 * (a trigger blocks UPDATE/DELETE) and every write in generate_bill,
 * record_payment, void, edit, etc. inserts a row. This page is the viewer
 * — filters by date range, by staff member, and by what kind of change,
 * so the OWNER can answer "who edited which bills last week?" in seconds.
 *
 * Permission gate via <PermissionGuard>: a staffer without `audit_log.view`
 * sees the friendly NoPermissionScreen with the list of teammates who can.
 */
export default function AuditLogPage() {
    return (
        <PermissionGuard permission="audit_log.view">
            <AuditLogClient />
        </PermissionGuard>
    )
}
