/** Message templates for transactional notifications. Keep them short — Twilio
 *  WhatsApp sandbox imposes a ~1600 char limit, but for ops messages 200-400 is plenty. */

export interface BillNotifyArgs {
    restaurantName: string
    invoiceNumber: string
    grandTotal: number
    paymentLink?: string
    publicBillUrl?: string
}

export interface ReservationNotifyArgs {
    restaurantName: string
    customerName: string
    partySize: number
    when: Date
    address?: string
}

export interface LowStockNotifyArgs {
    restaurantName: string
    items: Array<{ name: string; remaining: number; unit: string }>
}

export interface KitchenReadyArgs {
    restaurantName: string
    orderNumber: string
    table?: string
}

const fmtINR = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n)
const fmtDateTime = (d: Date) =>
    d.toLocaleString("en-IN", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })

export interface MarketingArgs {
    /** Pre-rendered message body. Templates simply pass it through. */
    message: string
}

export const templates = {
    marketing: ({ message }: MarketingArgs) => message,

    billGenerated: ({ restaurantName, invoiceNumber, grandTotal, paymentLink, publicBillUrl }: BillNotifyArgs) =>
        `🧾 *${restaurantName}*

Invoice ${invoiceNumber}
Amount: ${fmtINR(grandTotal)}
${paymentLink ? `\n💳 Pay now: ${paymentLink}` : ""}${publicBillUrl ? `\n📄 View bill: ${publicBillUrl}` : ""}

Thank you for visiting!`,

    paymentReceived: ({ restaurantName, invoiceNumber, grandTotal }: BillNotifyArgs) =>
        `✅ *${restaurantName}*

Payment received for ${invoiceNumber}: ${fmtINR(grandTotal)}.
Thanks — see you again soon!`,

    reservationConfirmed: ({ restaurantName, customerName, partySize, when, address }: ReservationNotifyArgs) =>
        `📅 *${restaurantName}*

Hi ${customerName}! Your reservation is confirmed.
👥 Party: ${partySize}
🕐 ${fmtDateTime(when)}
${address ? `📍 ${address}` : ""}

Reply CANCEL to cancel.`,

    reservationReminder: ({ restaurantName, customerName, when }: ReservationNotifyArgs) =>
        `⏰ *${restaurantName}*

Reminder, ${customerName}! Your table is reserved for ${fmtDateTime(when)}.
See you soon!`,

    lowStock: ({ restaurantName, items }: LowStockNotifyArgs) =>
        `⚠️ *${restaurantName}* — Low stock alert

${items.slice(0, 10).map((i) => `• ${i.name}: ${i.remaining} ${i.unit}`).join("\n")}

Time to reorder.`,

    orderReady: ({ restaurantName, orderNumber, table }: KitchenReadyArgs) =>
        `🍽️ *${restaurantName}*

Order ${orderNumber}${table ? ` (Table ${table})` : ""} is ready to serve.`,
}
