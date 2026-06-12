// Hand-rolled types matching the migration schema.
// To regenerate from a live Supabase project:
//   npx supabase gen types typescript --project-id YOUR_REF > src/types/database.ts

export type UserRole =
    | "OWNER"
    | "MANAGER"
    | "CASHIER"
    | "CAPTAIN"
    | "KITCHEN"
    | "DELIVERY"
    | "AUDITOR"

export type OrderStatus =
    | "OPEN"
    | "IN_PROGRESS"
    | "BILLED"
    | "PAID"
    | "CLOSED"
    | "VOID"
    | "ON_HOLD"

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "QSR"
export type FoodType = "VEG" | "NON_VEG" | "EGG" | "VEGAN"
export type BillStatus = "GENERATED" | "PAID" | "VOID"
export type PaymentMethod =
    | "CASH"
    | "UPI"
    | "CARD"
    | "RAZORPAY"
    | "PHONEPE"
    | "PAYTM"
    | "STRIPE"
    | "BANK_TRANSFER"
    | "CREDIT"
    | "COMPLIMENTARY"
    | "OTHER"
    | "GIFT_CARD"
    | "LOYALTY"

export type AuditAction =
    | "ORDER_CREATED"
    | "ITEM_ADDED"
    | "ITEM_REMOVED"
    | "ITEM_MODIFIED"
    | "DISCOUNT_APPLIED"
    | "BILL_GENERATED"
    | "BILL_EDITED"
    | "PAYMENT_ADDED"
    | "BILL_VOIDED"
    | "BILL_REPRINTED"

export interface Tenant {
    id: string
    name: string
    slug: string
    plan: "trial" | "starter" | "growth" | "enterprise"
    plan_expires_at: string | null
    gstin: string | null
    fssai: string | null
    pan: string | null
    phone: string | null
    email: string | null
    website: string | null
    logo_url: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    state_code: string | null
    pincode: string | null
    country: string
    currency: string
    timezone: string
    fy_start_month: number
    invoice_prefix: string
    service_charge_percent: number
    /** Tenant tax preferences — migration 38. The tax *model* + official
     *  rate slabs stay in src/lib/tax/locale-config.ts; these are the
     *  restaurant's own choices on top. */
    /** Rate pre-filled on new menu items; null ⇒ use the country default. */
    default_tax_rate: number | null
    /** New menu items default to tax-inclusive pricing. */
    prices_include_tax: boolean
    /** False ⇒ POS checkout defaults to "bill without tax". */
    tax_enabled: boolean
    /** Extra rates this restaurant may pick beyond the country's official slabs. */
    custom_tax_rates: number[]
    settings: Record<string, unknown>
    /** Saved customization for the printable QR-code card. Added in
     *  migration 16. See QrCardSettings below for shape. */
    qr_card_settings: QrCardSettings | null
    created_at: string
    updated_at: string
}

/** Shape of {@link Tenant.qr_card_settings}. Mirrors the JSONB stored on
 *  tenants.qr_card_settings — see migration 16. Defaults live in
 *  src/lib/qr-card-settings.ts. */
export interface QrCardSettings {
    show_restaurant_name?: boolean
    show_city?: boolean
    show_logo?: boolean
    header_color_1?: string
    header_color_2?: string
    use_solid_header?: boolean
    custom_text?: string
    /** QR-code size relative to the card width — preset chip, or "custom"
     *  to use the {@link qr_size_custom_percent} value. Defaults to "md". */
    qr_size?: "sm" | "md" | "lg" | "custom"
    /** Only used when {@link qr_size} === "custom". Percentage of the
     *  card's width that the QR occupies, clamped 30–80. */
    qr_size_custom_percent?: number
}

export interface AppUser {
    id: string
    tenant_id: string | null
    /** When the tenant has multiple branches, this scopes the staff member
     *  to one of them so the right person shows up at the right till and
     *  reports filter cleanly. Null = legacy / single-branch / unassigned.
     *  Column added in migration 02; populated through the staff-create
     *  flow updated in migration 18. */
    branch_id: string | null
    role: UserRole
    /** Assigned role template — drives the user's UI permission set.
     *  Added in migration 47 (role templates). NULL only for unmigrated
     *  legacy rows; backfill populates it on every existing user. */
    role_template_id: string | null
    full_name: string | null
    phone: string | null
    email: string | null
    avatar_url: string | null
    is_active: boolean
    last_seen_at: string | null
    created_at: string
    updated_at: string
}

export interface RoleTemplate {
    id: string
    tenant_id: string
    name: string
    description: string | null
    base_role: UserRole
    permissions: string[]
    is_system: boolean
    created_by: string | null
    created_at: string
    updated_at: string
}

// ── HR: attendance + payroll (migration 56) ────────────────────────────────

export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "DAILY_WAGE"
export type SalaryBasis = "MONTHLY" | "DAILY" | "HOURLY"
export type AttendanceStatus =
    | "PRESENT"
    | "ABSENT"
    | "HALF_DAY"
    | "LEAVE"
    | "HOLIDAY"
    | "WEEKLY_OFF"
export type AttendanceSource = "SELF" | "ADMIN" | "SYSTEM"
export type AttendanceAuditAction =
    | "PUNCH_IN"
    | "PUNCH_OUT"
    | "CREATE"
    | "UPDATE"
    | "DELETE"
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
export type PayslipStatus = "DRAFT" | "FINALIZED" | "PAID"
export type SalaryComponentType = "fixed" | "percent"

/** A configurable earning or deduction on an employee's salary structure.
 *  `percent` earnings are a % of earned base; `percent` deductions a % of
 *  gross. See the formula in migration 57 / src/lib/hr/salary.ts. */
export interface SalaryComponent {
    name: string
    type: SalaryComponentType
    amount: number
}
/** A computed line on a generated payslip (snapshot, amounts only). */
export interface PayslipLine {
    name: string
    amount: number
}

/** An entry in the unlimited employee roster — decoupled from login `users`
 *  (which are plan-limited). `user_id` optionally links a login account so
 *  that person can self-punch + (Phase 2) download their own slips. The
 *  salary_* columns are Phase-2 scaffolding, nullable until payroll ships. */
export interface HrEmployee {
    id: string
    tenant_id: string
    branch_id: string | null
    user_id: string | null
    emp_code: string | null
    full_name: string
    phone: string | null
    email: string | null
    designation: string | null
    department: string | null
    date_of_joining: string | null
    employment_type: EmploymentType
    photo_url: string | null
    salary_basis: SalaryBasis | null
    base_amount: number | null
    expected_hours_per_day: number | null
    weekly_offs: number[] | null
    /** Salary structure (migration 57). */
    earnings: SalaryComponent[]
    deductions: SalaryComponent[]
    bank_name: string | null
    bank_account: string | null
    bank_ifsc: string | null
    pan: string | null
    is_active: boolean
    created_at: string
    updated_at: string
}

/** One attendance row per employee per day (upsert key
 *  tenant_id+employee_id+work_date). */
export interface HrAttendance {
    id: string
    tenant_id: string
    employee_id: string
    branch_id: string | null
    work_date: string
    status: AttendanceStatus
    check_in: string | null
    check_out: string | null
    worked_minutes: number
    late_minutes: number
    overtime_minutes: number
    source: AttendanceSource
    notes: string | null
    marked_by: string | null
    created_at: string
    updated_at: string
}

/** Append-only history of every attendance change. */
export interface HrAttendanceAudit {
    id: string
    tenant_id: string
    employee_id: string | null
    attendance_id: string | null
    action: AttendanceAuditAction
    before_state: Record<string, unknown> | null
    after_state: Record<string, unknown> | null
    reason: string | null
    changed_by: string | null
    created_at: string
}

export interface HrHoliday {
    id: string
    tenant_id: string
    branch_id: string | null
    holiday_date: string
    name: string
    created_by: string | null
    created_at: string
}

export interface HrLeaveType {
    id: string
    tenant_id: string
    name: string
    is_paid: boolean
    annual_quota: number
    is_active: boolean
    created_at: string
}

export interface HrLeave {
    id: string
    tenant_id: string
    employee_id: string
    leave_type_id: string | null
    from_date: string
    to_date: string
    days: number
    reason: string | null
    status: LeaveStatus
    decided_by: string | null
    decided_at: string | null
    created_by: string | null
    created_at: string
    updated_at: string
}

export interface HrPayslip {
    id: string
    tenant_id: string
    employee_id: string
    branch_id: string | null
    period_month: string
    currency: string
    salary_basis: SalaryBasis
    base_amount: number
    working_days: number
    present_days: number
    half_days: number
    leave_days: number
    holiday_days: number
    weekly_off_days: number
    absent_days: number
    payable_days: number
    worked_minutes: number
    overtime_minutes: number
    overtime_amount: number
    earned_base: number
    gross_earnings: number
    total_deductions: number
    net_pay: number
    earnings: PayslipLine[]
    deductions: PayslipLine[]
    status: PayslipStatus
    notes: string | null
    generated_by: string | null
    finalized_at: string | null
    created_at: string
    updated_at: string
}

export interface MenuCategory {
    id: string
    tenant_id: string
    name: string
    description: string | null
    icon: string | null
    sort_order: number
    is_active: boolean
    available_from: string | null
    available_to: string | null
    available_days: number[]
    deleted_at: string | null
    created_at: string
    updated_at: string
}

export interface MenuItem {
    id: string
    tenant_id: string
    category_id: string | null
    name: string
    description: string | null
    base_price: number
    /** When set AND less than base_price, this is the active selling price
     *  (POS charges it, tile shows the original struck-through + a "% off"
     *  badge). Null means the item is sold at base_price. Added in migration
     *  13_menu_sale_price.sql. A DB CHECK constraint enforces > 0 and <
     *  base_price. */
    sale_price: number | null
    food_type: FoodType
    hsn_code: string | null
    gst_slab: number
    is_tax_inclusive: boolean
    sku: string | null
    barcode: string | null
    image_url: string | null
    prep_time_minutes: number
    is_active: boolean
    is_sold_out: boolean
    sort_order: number
    deleted_at: string | null
    created_at: string
    updated_at: string
}

export interface QrPaymentProof {
    id: string
    tenant_id: string
    order_id: string
    amount: number
    upi_id_used: string | null
    screenshot_url: string
    customer_name: string | null
    customer_phone: string | null
    status: "PENDING" | "VERIFIED" | "REJECTED"
    verified_by: string | null
    verified_at: string | null
    rejected_reason: string | null
    notes: string | null
    created_at: string
}

export interface ItemVariant {
    id: string
    tenant_id: string
    item_id: string
    name: string
    price_delta: number
    sort_order: number
    is_default: boolean
    deleted_at: string | null
    created_at: string
}

export interface ModifierGroup {
    id: string
    tenant_id: string
    name: string
    is_required: boolean
    min_select: number
    max_select: number
    sort_order: number
    deleted_at: string | null
    created_at: string
}

export interface Modifier {
    id: string
    tenant_id: string
    group_id: string
    name: string
    price_delta: number
    sort_order: number
    is_active: boolean
    deleted_at: string | null
    created_at: string
}

export interface DiningTable {
    id: string
    tenant_id: string
    number: string
    section: string
    capacity: number
    shape: "square" | "round" | "rectangle"
    pos_x: number
    pos_y: number
    status: "AVAILABLE" | "OCCUPIED" | "RESERVED" | "DIRTY" | "ON_HOLD"
    is_active: boolean
    created_at: string
    updated_at: string
}

export interface Customer {
    id: string
    tenant_id: string
    name: string | null
    phone: string | null
    email: string | null
    state: string | null
    state_code: string | null
    gstin: string | null
    loyalty_points: number
    loyalty_tier: LoyaltyTier
    total_visits: number
    total_spent: number
    last_visit_at: string | null
    date_of_birth: string | null
    anniversary_date: string | null
    tags: string[]
    notes: string | null
    deleted_at: string | null
    created_at: string
    updated_at: string
}

export interface Order {
    id: string
    tenant_id: string
    order_number: string
    status: OrderStatus
    order_type: OrderType
    table_id: string | null
    customer_id: string | null
    guest_count: number
    created_by: string | null
    billed_by: string | null
    voided_by: string | null
    billed_at: string | null
    paid_at: string | null
    voided_at: string | null
    subtotal: number
    item_discount: number
    order_discount: number
    taxable_amount: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    cess_amount: number
    service_charge: number
    round_off: number
    grand_total: number
    is_inter_state: boolean
    gst_excluded: boolean
    notes: string | null
    void_reason: string | null
    created_at: string
    updated_at: string
}

export interface OrderItem {
    id: string
    tenant_id: string
    order_id: string
    menu_item_id: string | null
    item_name: string
    hsn_code: string | null
    gst_slab: number
    variant_id: string | null
    variant_name: string | null
    quantity: number
    unit_price: number
    discount_amount: number
    taxable_amount: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    line_total: number
    modifiers: Array<{ name: string; price_delta: number }>
    notes: string | null
    kds_status: "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED"
    is_void: boolean
    void_reason: string | null
    created_at: string
    updated_at: string
}

export interface Bill {
    id: string
    tenant_id: string
    order_id: string
    invoice_number: string
    fy_label: string
    bill_status: BillStatus
    subtotal: number
    item_discount: number
    order_discount: number
    taxable_amount: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    cess_amount: number
    service_charge: number
    round_off: number
    grand_total: number
    is_inter_state: boolean
    gst_excluded: boolean
    customer_name: string | null
    customer_phone: string | null
    customer_gstin: string | null
    customer_state_code: string | null
    is_locked: boolean
    locked_at: string
    void_reason: string | null
    voided_by: string | null
    voided_at: string | null
    print_count: number
    last_printed_at: string | null
    created_at: string
    updated_at: string
}

export interface Payment {
    id: string
    tenant_id: string
    bill_id: string
    method: PaymentMethod
    amount: number
    reference: string | null
    received_by: string | null
    metadata: Record<string, unknown>
    created_at: string
}

export interface BillAuditLog {
    id: string
    tenant_id: string
    bill_id: string | null
    order_id: string | null
    user_id: string | null
    user_role: string | null
    action: AuditAction
    reason: string | null
    before_state: unknown
    after_state: unknown
    ip_address: string | null
    user_agent: string | null
    created_at: string
}

export interface HsnCode {
    code: string
    description: string
    default_gst: number
    is_service: boolean
    created_at: string
}

export interface Vendor {
    id: string
    tenant_id: string
    name: string
    gstin: string | null
    pan: string | null
    phone: string | null
    email: string | null
    address: string | null
    state: string | null
    state_code: string | null
    payment_terms: string | null
    notes: string | null
    deleted_at: string | null
    created_at: string
    updated_at: string
}

export interface Purchase {
    id: string
    tenant_id: string
    vendor_id: string | null
    purchase_number: string
    vendor_invoice_no: string | null
    vendor_invoice_date: string
    fy_label: string
    is_inter_state: boolean
    subtotal: number
    discount: number
    taxable_amount: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    cess_amount: number
    other_charges: number
    grand_total: number
    itc_eligible: boolean
    itc_claimed: boolean
    payment_status: "UNPAID" | "PARTIAL" | "PAID"
    paid_amount: number
    attachment_url: string | null
    notes: string | null
    created_by: string | null
    created_at: string
    updated_at: string
}

export interface PurchaseItem {
    id: string
    tenant_id: string
    purchase_id: string
    description: string
    hsn_code: string | null
    quantity: number
    unit: string
    unit_price: number
    discount: number
    taxable_amount: number
    gst_slab: number
    cgst_amount: number
    sgst_amount: number
    igst_amount: number
    line_total: number
    created_at: string
}

export type ExpensePLGroup =
    | "COGS"
    | "OPERATING"
    | "SALARIES"
    | "RENT"
    | "UTILITIES"
    | "MARKETING"
    | "FINANCE"
    | "DEPRECIATION"
    | "OTHER"

export interface ExpenseCategory {
    id: string
    tenant_id: string
    name: string
    pl_group: ExpensePLGroup
    is_active: boolean
    created_at: string
}

export interface Expense {
    id: string
    tenant_id: string
    category_id: string | null
    expense_date: string
    fy_label: string
    vendor_name: string | null
    description: string
    amount: number
    gst_amount: number
    payment_method: string | null
    reference: string | null
    attachment_url: string | null
    created_by: string | null
    created_at: string
}

export interface Branch {
    id: string
    tenant_id: string
    name: string
    code: string | null
    address_line1: string | null
    city: string | null
    state: string | null
    state_code: string | null
    pincode: string | null
    phone: string | null
    email: string | null
    is_main: boolean
    is_active: boolean
    /** Geofenced attendance pin (migration 60). NULL = staff can self-punch
     *  from anywhere; set = punches accepted only within the radius. */
    latitude: number | null
    longitude: number | null
    geofence_radius_m: number
    created_at: string
    updated_at: string
}

export interface BranchTaxProfile {
    id: string
    tenant_id: string
    branch_id: string
    country: string
    currency: string
    gstin: string | null
    pan: string | null
    fssai: string | null
    created_at: string
    updated_at: string
}

export interface StaffInvite {
    id: string
    tenant_id: string
    email: string
    role: UserRole
    full_name: string | null
    branch_id: string | null
    token: string
    status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"
    invited_by: string | null
    expires_at: string
    accepted_at: string | null
    created_at: string
}

export interface StockItem {
    id: string
    tenant_id: string
    branch_id: string | null
    name: string
    sku: string | null
    /** Scanned barcode (UPC / EAN / etc.). Unique per tenant; nullable
     *  because bulk ingredients usually don't have one. The inventory
     *  batch dialog looks up by this column on every scan. */
    barcode: string | null
    unit: string
    current_stock: number
    reorder_level: number
    cost_price: number
    hsn_code: string | null
    notes: string | null
    is_active: boolean
    deleted_at: string | null
    created_at: string
    updated_at: string
}

export interface StockMovement {
    id: string
    tenant_id: string
    stock_item_id: string
    type: "IN" | "OUT" | "WASTAGE" | "ADJUSTMENT" | "CONSUMPTION"
    quantity: number
    unit_cost: number
    reason: string | null
    reference_type: string | null
    reference_id: string | null
    /** When set, points at the parent stock_movement_batches row that
     *  groups N item rows entered together by one storekeeper. NULL for
     *  legacy single-row movements created before migration 09. */
    batch_id: string | null
    performed_by: string | null
    created_at: string
}

/** Live link between a cashier POS device and a customer-facing display
 *  screen. Cashier writes; the public /display/<tenant_slug> page reads
 *  via Supabase Realtime. Cart is a denormalised snapshot so the display
 *  device never needs to read the menu table. */
export interface PosDisplaySession {
    id: string
    tenant_id: string
    branch_id: string | null
    /** BUILDING_CART = cashier is still adding items, display shows cart
     *  but NOT the payment QR. AWAITING_PAYMENT = cashier hit Review &
     *  checkout, QR is now safe to show. The rest are end states. */
    status: "BUILDING_CART" | "AWAITING_PAYMENT" | "PROCESSING" | "PAID" | "CLOSED"
    /** Denormalised cart lines — the display reads ONLY this, never
     *  menu_items, so every field it renders (name, qty, price, the
     *  optional dish photo) is inlined here. */
    cart_payload: Array<{
        name: string
        quantity: number
        unit_price: number
        notes?: string | null
        image_url?: string | null
    }>
    subtotal: number
    tax_total: number
    /** Coupon / order discount applied to this cart. Streamed so the
     *  display can show a "Discount −₹X" line and a coupon-code badge. */
    discount_total: number
    /** Applied coupon code, or null. Shown as a badge on the display. */
    coupon_code: string | null
    /** grand_total is the FINAL payable — already net of discount_total. */
    grand_total: number
    currency: string
    upi_id: string | null
    upi_payee_name: string | null
    /** Set once generate_bill returns. Drives the "Paid · INV-…" screen. */
    invoice_number: string | null
    order_type: string | null
    table_no: string | null
    /** Customer attached on the POS via the phone-lookup card. Streamed
     *  to the display so the customer sees "Hi <Name>" when applicable. */
    customer_name: string | null
    customer_phone: string | null
    /** Order backing this checkout (created on Review & checkout for
     *  international Stripe flow; null for India / pre-checkout). */
    order_id: string | null
    /** Stripe-hosted Checkout URL for international tenants. Display
     *  renders this as a QR. Null for India (UPI is used instead). */
    checkout_url: string | null
    /** Stripe Checkout Session id — used by webhook handler. */
    checkout_session_id: string | null
    created_by: string | null
    created_at: string
    updated_at: string
    expires_at: string
}

/** Audit-tracked batch of stock movements — one delivery / one reconcile /
 *  one wastage entry typically. Created by a storekeeper, verified by a
 *  different manager (segregation of duties enforced in RPC). */
export interface StockMovementBatch {
    id: string
    tenant_id: string
    branch_id: string | null
    type: "IN" | "OUT" | "WASTAGE" | "ADJUSTMENT"
    reference_no: string | null
    supplier: string | null
    notes: string | null
    status: "PENDING" | "VERIFIED" | "REJECTED"
    rejection_reason: string | null
    created_by: string
    verified_by: string | null
    verified_at: string | null
    created_at: string
    updated_at: string
}

export interface Recipe {
    id: string
    tenant_id: string
    menu_item_id: string
    yield_per_unit: number
    notes: string | null
    created_at: string
    updated_at: string
}

export interface RecipeItem {
    id: string
    tenant_id: string
    recipe_id: string
    stock_item_id: string
    quantity: number
    unit: string | null
    notes: string | null
}

export interface Reservation {
    id: string
    tenant_id: string
    branch_id: string | null
    customer_name: string
    customer_phone: string | null
    customer_email: string | null
    party_size: number
    reserved_for: string
    duration_minutes: number
    table_id: string | null
    status: "PENDING" | "CONFIRMED" | "SEATED" | "CANCELLED" | "NO_SHOW" | "COMPLETED"
    special_requests: string | null
    notes: string | null
    confirmation_sent: boolean
    reminder_sent: boolean
    created_by: string | null
    created_at: string
    updated_at: string
}

export interface LoyaltyTransaction {
    id: string
    tenant_id: string
    customer_id: string
    bill_id: string | null
    type: "EARN" | "REDEEM" | "ADJUSTMENT" | "EXPIRY"
    points: number
    notes: string | null
    created_at: string
}

export interface ActivityLog {
    id: string
    tenant_id: string
    user_id: string | null
    action: string
    entity_type: string | null
    entity_id: string | null
    metadata: Record<string, unknown>
    ip_address: string | null
    user_agent: string | null
    created_at: string
}

export type LoyaltyTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM"

export interface Coupon {
    id: string
    tenant_id: string
    code: string
    description: string | null
    type: "PERCENT" | "FLAT"
    value: number
    min_order_amount: number
    max_discount: number | null
    valid_from: string
    valid_until: string | null
    usage_limit: number | null
    usage_per_customer: number
    times_used: number
    applies_to: "ALL" | "BIRTHDAY" | "WIN_BACK" | "NEW_CUSTOMER" | "TIER"
    required_tier: LoyaltyTier | null
    is_active: boolean
    created_by: string | null
    created_at: string
    updated_at: string
}

export interface GiftCard {
    id: string
    tenant_id: string
    code: string
    initial_value: number
    current_balance: number
    issued_to_name: string | null
    issued_to_phone: string | null
    issued_to_email: string | null
    issued_by_bill_id: string | null
    expires_at: string | null
    is_active: boolean
    notes: string | null
    created_by: string | null
    created_at: string
    updated_at: string
}

export interface GiftCardTransaction {
    id: string
    tenant_id: string
    gift_card_id: string
    bill_id: string | null
    type: "ISSUE" | "REDEEM" | "TOPUP" | "REFUND" | "EXPIRY"
    amount: number
    balance_after: number
    notes: string | null
    created_by: string | null
    created_at: string
}

export interface BankTransaction {
    id: string
    tenant_id: string
    statement_id: string | null
    txn_date: string
    description: string | null
    reference: string | null
    amount: number
    type: "CREDIT" | "DEBIT" | null
    matched_payment_id: string | null
    matched_at: string | null
    matched_by: string | null
    is_reconciled: boolean
    notes: string | null
    created_at: string
}

export interface MarketingCampaign {
    id: string
    tenant_id: string
    name: string
    type: "WIN_BACK" | "BIRTHDAY" | "ANNIVERSARY" | "PROMO" | "BROADCAST"
    channel: "whatsapp" | "sms" | "email"
    coupon_id: string | null
    target_count: number
    sent_count: number
    failed_count: number
    status: "DRAFT" | "SENDING" | "COMPLETED" | "FAILED"
    created_by: string | null
    created_at: string
    completed_at: string | null
}

export interface BalanceSheetEntry {
    id: string
    tenant_id: string
    fy_label: string
    section: "ASSETS" | "LIABILITIES" | "EQUITY"
    sub_section: string
    head: string
    opening_balance: number
    closing_balance: number
    notes: string | null
    created_at: string
    updated_at: string
}

// Database envelope used by the Supabase client. Tables list every public table;
// rows / inserts / updates are simplified to the row type for ergonomics.
type T<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] }

export interface Database {
    public: {
        Tables: {
            tenants: T<Tenant>
            users: T<AppUser>
            hsn_codes: T<HsnCode>
            menu_categories: T<MenuCategory>
            menu_items: T<MenuItem>
            item_variants: T<ItemVariant>
            modifier_groups: T<ModifierGroup>
            modifiers: T<Modifier>
            item_modifier_groups: T<{ item_id: string; group_id: string; sort_order: number }>
            dining_tables: T<DiningTable>
            customers: T<Customer>
            tenant_sequences: T<{ tenant_id: string; seq_type: string; fy_label: string; last_value: number }>
            orders: T<Order>
            order_items: T<OrderItem>
            bills: T<Bill>
            payments: T<Payment>
            bill_audit_log: T<BillAuditLog>
            vendors: T<Vendor>
            purchases: T<Purchase>
            purchase_items: T<PurchaseItem>
            expense_categories: T<ExpenseCategory>
            expenses: T<Expense>
            balance_sheet_entries: T<BalanceSheetEntry>
        }
        Functions: {
            generate_bill: {
                Args: {
                    p_order_id: string
                    p_customer_id?: string | null
                    p_service_charge?: number
                    p_order_discount?: number
                    p_round_off?: number
                    p_no_gst?: boolean
                    p_tax_model?: string
                    /** Pre-reserved invoice number string (offline buffer). */
                    p_reserved_invoice?: string | null
                    /** Idempotency key — same value always returns the same bill. */
                    p_client_request_id?: string | null
                    /** Device clock at print time. When set (offline sync), gets
                     *  written to bills.created_at + orders.billed_at; bills.synced_at
                     *  always captures the actual insert moment. Omit on online path. */
                    p_created_at?: string | null
                }
                Returns: {
                    bill_id: string
                    invoice_number: string
                    grand_total: number
                    taxable_amount: number
                    cgst_amount: number
                    sgst_amount: number
                    igst_amount: number
                    is_inter_state: boolean
                    gst_excluded: boolean
                    tax_model: string
                    idempotent_replay?: boolean
                }
            }
            record_payment: {
                Args: {
                    p_bill_id: string
                    p_method: PaymentMethod
                    p_amount: number
                    p_reference?: string | null
                    p_metadata?: Record<string, unknown>
                }
                Returns: { payment_id: string; total_paid: number; fully_paid: boolean }
            }
            void_bill: {
                Args: { p_bill_id: string; p_reason: string }
                Returns: { voided: boolean }
            }
            release_user_reservations: {
                /** Releases (immediately expires) all unclaimed invoice
                 *  reservations belonging to the given user, so the next
                 *  reserve_invoice_numbers call can re-issue them. Called by
                 *  the staff page on deactivation; can also be called by a
                 *  user against their own id (e.g. clear-this-device flow). */
                Args: { p_user_id: string }
                Returns: number
            }
            current_tenant_id: { Args: Record<string, never>; Returns: string | null }
            current_user_role: { Args: Record<string, never>; Returns: UserRole | null }
        }
        Enums: Record<string, never>
    }
}
