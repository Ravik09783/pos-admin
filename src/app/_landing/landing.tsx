"use client"

import Link from "next/link"
import dynamic from "next/dynamic"
import { motion } from "framer-motion"
import {
    ArrowRight, BarChart3, Bike, Boxes, Brain, Building2, Calendar, Camera,
    Check, ChefHat, Gift, Globe, Landmark, Lock, Mail, MapPin, Menu,
    MessageCircle, Monitor, Phone, Receipt, ShieldCheck, Sparkles, Star,
    Users, Wallet, WifiOff, X, Zap,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { SITE_FAQ } from "@/lib/site"
import { getPlans, formatPlanPrice, type PlanRegion } from "@/lib/billing/plans"
import { HeroDevices } from "./hero-devices"
import { CountUp } from "./count-up"
import { AIMenuImportShowcase } from "./ai-menu-import-showcase"
import { CAExportShowcase } from "./ca-export-showcase"
import { HeadlineReveal, MouseParallax } from "./hero-effects"
import { SectionHeading } from "./section-heading"
import { CardTilt } from "./card-tilt"
import { StepConnectorLine, PortalRings, PulseDot } from "./section-flourishes"

// Purely-decorative ambient effects — zero text, zero SEO value. Loaded
// lazily and client-only (ssr: false) so they're code-split OUT of the
// initial JS bundle and never block first paint or interactivity: the
// page's real content renders first, this chrome fades in a beat later.
// This is the single biggest Core Web Vitals win on the landing page.
const AuroraBackground = dynamic(() => import("./aurora-background").then((m) => m.AuroraBackground), { ssr: false })
const CursorSpotlight = dynamic(() => import("./cursor-spotlight").then((m) => m.CursorSpotlight), { ssr: false })
const AmbientParticles = dynamic(() => import("./ambient-particles").then((m) => m.AmbientParticles), { ssr: false })
const ScrollProgress = dynamic(() => import("./scroll-progress").then((m) => m.ScrollProgress), { ssr: false })

export function LandingPage() {
    return (
        <LandingShell>
            <Hero />
            <TrustBar />
            <Features />
            <AIMenuImportShowcase />
            <CAExportShowcase />
            <HowItWorks />
            <ComparisonTable />
            <Pricing />
            <Testimonials />
            <FAQ />
            <FinalCTA />
        </LandingShell>
    )
}

// ============ SHELL ============
// Wraps any marketing page with the cinematic backdrop, the sticky Header,
// and the Footer. New pages (e.g. /features, /pricing, /demo) compose
// `<LandingShell>{...sections}</LandingShell>` so the chrome stays
// identical and only the body changes.
export function LandingShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="relative min-h-screen overflow-x-hidden">
            <AuroraBackground />
            <CursorSpotlight />
            <ScrollProgress />
            <Header />
            {children}
            <Footer />
        </div>
    )
}

// ============ HEADER ============
// Route-based links — every label goes to its own page now that the
// marketing site is split. Sticky behaviour (background fade on scroll)
// + mobile drawer state are owned by the component itself, not lifted.
export function Header() {
    const [scrolled, setScrolled] = useState(false)
    const [mobileNav, setMobileNav] = useState(false)
    // Auth state — `null` while we don't know yet, `true` for signed-in,
    // `false` for guests. We resolve it client-side via
    // `getSession()` (which just reads the local cookie, no network
    // round-trip) plus `onAuthStateChange` for hot swaps. The landing
    // page stays a static prerender for guests — we just decide which
    // header buttons to paint AFTER hydration, so SEO crawlers still
    // see the marketing CTAs and authed users don't get nudged toward
    // "Sign in" / "Start free trial" links they no longer need.
    const supabase = useMemo(() => createClient(), [])
    const [isAuthed, setIsAuthed] = useState<boolean | null>(null)
    useEffect(() => {
        let alive = true
        supabase.auth.getSession().then(({ data }) => {
            if (alive) setIsAuthed(!!data.session)
        })
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            if (alive) setIsAuthed(!!session)
        })
        return () => {
            alive = false
            sub.subscription.unsubscribe()
        }
    }, [supabase])

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20)
        window.addEventListener("scroll", onScroll, { passive: true })
        return () => window.removeEventListener("scroll", onScroll)
    }, [])

    const links = [
        { href: "/features", label: "Features" },
        { href: "/pricing", label: "Pricing" },
        { href: "/demo", label: "Book a demo" },
    ]
    return (
        <header className={cn(
            "sticky top-0 z-50 transition-all duration-300",
            scrolled ? "bg-background/80 backdrop-blur-xl border-b border-border/50" : "bg-transparent",
        )}>
            <div className="container mx-auto flex items-center justify-between py-4 px-4">
                <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                    <span className="grid place-items-center h-9 w-9 rounded-lg bg-primary text-primary-foreground shadow-sm">
                        <Sparkles className="h-4 w-4" />
                    </span>
                    <span className="text-lg">RestoPOS</span>
                </Link>
                <nav className="hidden md:flex items-center gap-6 text-sm">
                    {links.map((l) => (
                        <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground transition-colors">
                            {l.label}
                        </Link>
                    ))}
                </nav>
                <div className="hidden md:flex items-center gap-2">
                    <ThemeToggle />
                    {/* Auth-aware CTAs. While we don't know yet
                      * (`isAuthed === null`) we render a width-reserving
                      * placeholder so the header doesn't visibly jump
                      * once the session resolves. */}
                    {isAuthed === true ? (
                        <Button asChild variant="neon" size="sm">
                            <Link href="/menu">Open app <ArrowRight className="h-4 w-4" /></Link>
                        </Button>
                    ) : isAuthed === false ? (
                        <>
                            <Button asChild variant="ghost" size="sm"><Link href="/login">Sign in</Link></Button>
                            <Button asChild variant="neon" size="sm"><Link href="/signup">Start free trial</Link></Button>
                        </>
                    ) : (
                        <div className="h-9 w-[200px]" aria-hidden />
                    )}
                </div>
                <div className="md:hidden flex items-center gap-1">
                    <ThemeToggle />
                    <button className="p-2" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation">
                        {mobileNav ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>
            {mobileNav && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:hidden border-t border-border/40 bg-background/95 backdrop-blur-xl px-4 py-4 space-y-3"
                >
                    {links.map((l) => (
                        <Link key={l.href} href={l.href} onClick={() => setMobileNav(false)} className="block text-sm text-muted-foreground hover:text-foreground">{l.label}</Link>
                    ))}
                    {isAuthed === true ? (
                        <div className="pt-2 border-t border-border/40">
                            <Button asChild variant="neon" size="sm" className="w-full">
                                <Link href="/menu" onClick={() => setMobileNav(false)}>
                                    Open app <ArrowRight className="h-4 w-4" />
                                </Link>
                            </Button>
                        </div>
                    ) : isAuthed === false ? (
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40">
                            <Button asChild variant="outline" size="sm"><Link href="/login" onClick={() => setMobileNav(false)}>Sign in</Link></Button>
                            <Button asChild variant="neon" size="sm"><Link href="/signup" onClick={() => setMobileNav(false)}>Start trial</Link></Button>
                        </div>
                    ) : (
                        <div className="pt-2 border-t border-border/40 h-9" aria-hidden />
                    )}
                </motion.div>
            )}
        </header>
    )
}

// ============ HERO ============
export function Hero() {
    return (
        <section className="relative container mx-auto px-4 pt-12 md:pt-24 pb-16 md:pb-32">
            {/* Floating particles drifting up behind the hero — gives the "stepping into a new world" feel. */}
            <AmbientParticles count={28} />

            <div className="relative grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-16 items-center">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <Badge variant="neon" className="mb-5">
                            <Sparkles className="h-3 w-3 mr-1" /> Tax-ready in 30+ countries · GST · VAT · Sales Tax
                        </Badge>
                    </motion.div>

                    <HeadlineReveal
                        prefix="Run your restaurant."
                        highlight="Skip the paperwork."
                    />

                    <motion.p
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
                        className="mt-6 text-lg text-muted-foreground max-w-xl text-balance"
                    >
                        Browser-based POS with built-in tax — GST, VAT or sales tax, tuned to your country, currency and fiscal year. Generate bills, run your kitchen, take QR orders with auto-confirmed UPI (PhonePe or Paytm — customers pay from any UPI app, Google Pay included), and manage staff attendance &amp; salary slips — unlimited staff on every plan. Run one outlet or a whole chain: switch locations with one click and every menu, order and report re-scopes. In India? Export everything your CA needs in one click — GSTR-1, GSTR-3B, P&amp;L and Balance Sheet — per location or all together.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.85, ease: [0.16, 1, 0.3, 1] }}
                        className="mt-8 flex flex-wrap items-center gap-3"
                    >
                        <Button asChild variant="neon" size="xl" className="text-base">
                            <Link href="/signup">
                                Start 30-day free trial <ArrowRight className="h-4 w-4" />
                            </Link>
                        </Button>
                        <Button asChild variant="outline" size="xl" className="text-base">
                            <Link href="/features">See features</Link>
                        </Button>
                    </motion.div>

                    <motion.ul
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, delay: 1.0 }}
                        className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"
                    >
                        <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success" /> No credit card</li>
                        <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success" /> Setup in 15 min</li>
                        <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success" /> Cancel anytime</li>
                    </motion.ul>
                </motion.div>

                <MouseParallax>
                    <HeroDevices />
                </MouseParallax>
            </div>
        </section>
    )
}

// ============ TRUST BAR ============
export function TrustBar() {
    const stats = [
        { value: 5, suffix: "★", label: "Restaurant-tested UI" },
        { value: 30, suffix: "+", label: "Countries' tax models" },
        { value: 100, suffix: "%", label: "Browser-based" },
        { value: 15, suffix: " min", label: "Average setup time" },
    ]
    return (
        <section className="relative border-y border-border/40 bg-card/30 backdrop-blur-sm overflow-hidden">
            {/* Faint horizontal aurora streak behind the stats */}
            <motion.div
                aria-hidden
                className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-32 pointer-events-none"
                style={{
                    background:
                        "radial-gradient(ellipse 50% 100% at 30% 50%, hsl(var(--neon-cyan)/0.12), transparent 60%), radial-gradient(ellipse 50% 100% at 70% 50%, hsl(var(--neon-magenta)/0.12), transparent 60%)",
                }}
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative container mx-auto px-4 py-10">
                <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-30px" }}
                    variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
                    className="grid grid-cols-2 md:grid-cols-4 gap-6"
                >
                    {stats.map((s, i) => (
                        <motion.div
                            key={i}
                            variants={{
                                hidden: { opacity: 0, y: 16, scale: 0.92 },
                                visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
                            }}
                            className="text-center"
                        >
                            <div className="text-3xl md:text-4xl font-bold text-gradient">
                                <CountUp to={s.value} />{s.suffix}
                            </div>
                            <div className="text-xs md:text-sm text-muted-foreground mt-1">{s.label}</div>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </section>
    )
}

// ============ FEATURES ============
export function Features() {
    const features = [
        { icon: Camera, title: "AI Menu Import", desc: "Snap a photo of your printed menu — categories, items, prices and food types get auto-extracted. Review, tweak, save. Onboarding goes from hours to minutes." },
        { icon: Lock, title: "Bill Lock Security", desc: "Once a bill is generated, only the Owner can edit. Every change goes to an immutable audit log." },
        { icon: ChefHat, title: "Realtime Kitchen Display", desc: "Orders fly to the kitchen via WebSockets. Color-coded urgency. Multi-station routing." },
        { icon: Wallet, title: "Country-aware Tax Engine", desc: "GST, VAT or sales tax — computed per item, rounded correctly, inter-state / inter-region aware. Pick your country; we ship the rates (India, US states, EU, Gulf & more)." },
        { icon: Receipt, title: "QR Table Ordering", desc: "Guests scan, browse, pay online — UPI via PhonePe / Paytm in India, Stripe cards abroad — and the order auto-flows to your KDS. No app install, prices in your currency." },
        { icon: Zap, title: "UPI Auto-Confirm Payments", desc: "Connect PhonePe or Paytm Business — customers scan a dynamic QR from any UPI app (Google Pay, PhonePe, Paytm, BHIM), money settles to your own bank, and the bill confirms itself the moment they pay. Plain-UPI fallback included." },
        { icon: Building2, title: "Multi-Outlet Management", desc: "Add branches as you grow. One switcher in the top bar re-scopes the whole app — menus, orders, bills, reports — to a location. Copy a menu to a new outlet in one click; staff stay pinned to theirs." },
        { icon: Users, title: "Staff Attendance & Payroll", desc: "Geofenced punch in/out (staff must be within ~50 m of your outlet), auto-checkout for forgotten punch-outs, monthly sheets, leaves & holidays — and one-click professional salary-slip PDFs." },
        { icon: WifiOff, title: "Offline-Proof Billing", desc: "Internet down mid-shift? Keep billing with real pre-reserved invoice numbers; everything syncs back automatically — duplicates are physically impossible." },
        { icon: Boxes, title: "Inventory, Vendors & Purchases", desc: "Track stock, manage vendors, and log purchase invoices with input-tax-credit flags — your purchase register flows straight into the accountant export." },
        { icon: Landmark, title: "Accounting & Bank Reconciliation", desc: "Expenses by P&L group, balance-sheet inputs, a payments dashboard, and statement-vs-system bank reconciliation — light bookkeeping inside the POS." },
        { icon: Monitor, title: "Customer-Facing Display", desc: "A second screen per counter mirrors the cart live as the cashier rings up, then shows the payment QR. Any tablet with a browser works — no extra hardware." },
        { icon: Bike, title: "Swiggy & Zomato Tracking", desc: "Tag aggregator orders, track commission and expected payouts per platform, and reconcile their monthly settlements against your own numbers." },
        { icon: Brain, title: "AI-style Insights", desc: "Anomaly detection, demand forecasting, customer win-back signals — all driven by your own data, no paid LLMs." },
        { icon: Gift, title: "Loyalty + Coupons", desc: "Auto-tiered loyalty (Bronze→Platinum), promo codes, gift cards, birthday + anniversary auto-greetings." },
        { icon: Calendar, title: "Reservations", desc: "Book up to 30 days in advance. Walk-in waitlist. Status flow from confirmed to seated to completed." },
        { icon: ShieldCheck, title: "Roles & Granular Permissions", desc: "Owner, manager, cashier, kitchen and more out of the box — or build custom role templates with per-permission overrides. Staff see their own branch; admins see everything." },
        { icon: BarChart3, title: "Live Reports, Any Format", desc: "Hourly heatmaps, top items, payment splits, daily trends — filtered by location and any date range, downloadable as CSV, Excel or PDF." },
    ]
    return (
        <section id="features" className="container mx-auto px-4 py-20 md:py-28">
            <SectionHeading
                kicker="Features"
                prefix="Everything a modern restaurant needs."
                highlight="Nothing it doesn't."
                description="Built for fast-moving restaurants anywhere. Works on any tablet, phone, or desktop with a browser."
                className="mb-12 md:mb-16 max-w-2xl"
            />

            <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={{
                    visible: { transition: { staggerChildren: 0.07 } },
                }}
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
                {features.map((f) => (
                    <motion.div
                        key={f.title}
                        variants={{
                            hidden: { opacity: 0, y: 24, scale: 0.96 },
                            visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
                        }}
                    >
                        <CardTilt className="h-full">
                            <div className="group relative rounded-2xl glass border border-border/50 p-6 h-full transition-all hover:border-primary/40 hover:shadow-glow">
                                <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    <div className="absolute -inset-px rounded-2xl bg-border/60r from-primary/20 via-transparent to-[hsl(var(--neon-magenta)/0.2)] opacity-50 blur-md" />
                                </div>
                                <div className="relative">
                                    <motion.div
                                        whileHover={{ scale: 1.1, rotate: 6 }}
                                        transition={{ type: "spring", stiffness: 300, damping: 18 }}
                                        className="grid place-items-center h-11 w-11 rounded-lg bg-primary/15 mb-4"
                                    >
                                        <f.icon className="h-5 w-5 text-primary" />
                                    </motion.div>
                                    <h3 className="font-semibold text-lg mb-1.5">{f.title}</h3>
                                    <p className="text-sm text-muted-foreground">{f.desc}</p>
                                </div>
                            </div>
                        </CardTilt>
                    </motion.div>
                ))}
            </motion.div>
        </section>
    )
}

// ============ HOW IT WORKS ============
export function HowItWorks() {
    const steps = [
        {
            num: "01",
            title: "Sign up + pick your country",
            desc: "Email + password. Add your restaurant and pick your country — we set up the right tax model, currency and fiscal year. India also gets GSTIN / FSSAI fields and seeded HSN codes. Two minutes, tops.",
        },
        {
            num: "02",
            title: "Snap your menu — AI does the typing",
            desc: "Upload a photo of your printed menu. Our AI extracts every category, item, price and food type — and writes a short description for each dish. Review the rows, hit save. Add tables and print branded QR cards in the same sitting.",
        },
        {
            num: "03",
            title: "Take orders, generate tax-compliant bills",
            desc: "Bill the customer, payment auto-confirms, kitchen gets it instantly. In India, every transaction also lands in the one-click CA Export bundle.",
        },
    ]
    return (
        <section className="container mx-auto px-4 py-20 md:py-28">
            <SectionHeading
                kicker="How it works"
                prefix="From a photo of your menu to your first bill in"
                highlight="under 15 minutes."
                className="mb-12 max-w-2xl"
            />
            <div className="relative grid md:grid-cols-3 gap-6">
                <StepConnectorLine />
                {steps.map((step, i) => (
                    <motion.div
                        key={step.num}
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "-50px" }}
                        transition={{ delay: 0.2 + i * 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        className="relative"
                    >
                        <CardTilt intensity={0.4} className="h-full">
                            <div className="relative rounded-2xl glass border border-border/50 p-6 h-full overflow-hidden group">
                                <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-border/60r from-primary/15 to-[hsl(var(--neon-magenta)/0.1)] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                                <div className="relative">
                                    <div className="text-5xl font-bold text-gradient opacity-90 mb-3 flex items-center gap-3">
                                        {step.num}
                                        <PulseDot />
                                    </div>
                                    <h3 className="font-semibold text-xl mb-2">{step.title}</h3>
                                    <p className="text-sm text-muted-foreground">{step.desc}</p>
                                </div>
                            </div>
                        </CardTilt>
                        {i < steps.length - 1 && (
                            <motion.div
                                initial={{ opacity: 0, x: -8 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: 1.0 + i * 0.2, duration: 0.4 }}
                                className="hidden md:block absolute -right-4 top-1/2 -translate-y-1/2 z-10"
                            >
                                <div className="grid place-items-center h-8 w-8 rounded-full bg-card border border-border">
                                    <ArrowRight className="h-4 w-4 text-primary" />
                                </div>
                            </motion.div>
                        )}
                    </motion.div>
                ))}
            </div>
        </section>
    )
}

// ============ COMPARISON ============
export function ComparisonTable() {
    const features = [
        { label: "Browser-based (no install)", us: true, petpooja: false, posist: "partial" },
        { label: "Bill lock + immutable audit log", us: true, petpooja: false, posist: "partial" },
        { label: "1-click CA export (GSTR-1 + 3B + P&L + BS)", us: true, petpooja: false, posist: false },
        { label: "Realtime KDS via WebSockets", us: true, petpooja: true, posist: true },
        { label: "QR table ordering (PWA)", us: true, petpooja: "partial", posist: true },
        { label: "Built-in UPI payments (PhonePe + Paytm)", us: true, petpooja: false, posist: false },
        { label: "Geofenced staff attendance + salary slips", us: true, petpooja: false, posist: false },
        { label: "Unlimited staff accounts on every plan", us: true, petpooja: false, posist: false },
        { label: "Demand forecasting + insights", us: true, petpooja: false, posist: false },
        { label: "Tiered loyalty + gift cards + coupons", us: true, petpooja: true, posist: true },
        { label: "Bank reconciliation", us: true, petpooja: false, posist: false },
        { label: "Starting price (₹/mo, India)", us: "₹3,500", petpooja: "₹1,999", posist: "₹2,500" },
    ]
    return (
        <section className="container mx-auto px-4 py-20 md:py-28">
            <SectionHeading
                kicker="Vs competitors"
                prefix="More features."
                highlight="Less money."
                align="center"
                className="mb-12 max-w-2xl"
            />
            <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl glass-strong border border-border/60 overflow-x-auto relative"
            >
                {/* Subtle accent glow that animates with the table */}
                <motion.div
                    aria-hidden
                    className="absolute inset-0 rounded-2xl pointer-events-none"
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.5, delay: 0.3 }}
                    style={{
                        background: "linear-gradient(135deg, hsl(var(--neon-cyan)/0.05), transparent 50%, hsl(var(--neon-magenta)/0.05))",
                    }}
                />
                <table className="relative w-full text-sm">
                    <thead>
                        <tr className="border-b border-border/40">
                            <th className="text-left p-4 font-medium text-muted-foreground">Feature</th>
                            <th className="p-4 font-bold">
                                <span className="inline-flex items-center gap-1.5">
                                    <motion.span
                                        animate={{ rotate: [0, 8, -8, 0] }}
                                        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                                        className="grid place-items-center h-6 w-6 rounded bg-border/60r from-primary to-[hsl(var(--neon-magenta))]"
                                    >
                                        <Sparkles className="h-3 w-3 text-primary-foreground" />
                                    </motion.span>
                                    RestoPOS
                                </span>
                            </th>
                            <th className="p-4 text-muted-foreground">Petpooja</th>
                            <th className="p-4 text-muted-foreground">Posist</th>
                        </tr>
                    </thead>
                    <motion.tbody
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true, margin: "-50px" }}
                        variants={{ visible: { transition: { staggerChildren: 0.04, delayChildren: 0.2 } } }}
                    >
                        {features.map((f, i) => (
                            <motion.tr
                                key={i}
                                variants={{
                                    hidden: { opacity: 0, x: -16 },
                                    visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
                                }}
                                className={cn("border-b border-border/30", i % 2 === 0 ? "bg-card/20" : "")}
                            >
                                <td className="p-4 text-muted-foreground">{f.label}</td>
                                <td className="p-4 text-center"><Cell value={f.us} highlight /></td>
                                <td className="p-4 text-center"><Cell value={f.petpooja} /></td>
                                <td className="p-4 text-center"><Cell value={f.posist} /></td>
                            </motion.tr>
                        ))}
                    </motion.tbody>
                </table>
            </motion.div>
        </section>
    )
}

function Cell({ value, highlight }: { value: boolean | string | "partial"; highlight?: boolean }) {
    if (value === true) return <Check className={cn("h-5 w-5 mx-auto", highlight ? "text-success" : "text-muted-foreground")} />
    if (value === false) return <X className="h-5 w-5 mx-auto text-muted-foreground/40" />
    if (value === "partial") return <span className="text-warning text-xs">Partial</span>
    return <span className={cn(highlight ? "font-bold text-gradient" : "")}>{value}</span>
}

// ============ PRICING ============
// Three tiers per region — the country toggle swaps the trio.
// India: ₹3,500 / ₹5,000 / ₹10,000 — Starter / Growth / Scale
// INTL : $49    / $99    / $199    — Starter / Growth / Scale
// Plan definitions live in src/lib/billing/plans.ts (single source of truth).
export function Pricing() {
    const [region, setRegion] = useState<PlanRegion>("IN")
    const plans = getPlans(region)

    return (
        <section id="pricing" className="container mx-auto px-4 py-20 md:py-28">
            <SectionHeading
                kicker="Pricing"
                prefix="Pick the size that fits."
                highlight="Upgrade anytime."
                description="Three tiers, scaling on outlets and seats. Every plan ships the full RestoPOS feature set — tiers only change the headcount + outlet limits."
                align="center"
                className="mb-10 max-w-2xl"
            />

            {/* Country toggle — two pills, the active one glows. */}
            <div className="flex justify-center mb-12">
                <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 p-1 backdrop-blur-md">
                    {([
                        { id: "IN" as const, label: "🇮🇳 India (₹)" },
                        { id: "INTL" as const, label: "🌍 Other countries ($)" },
                    ]).map((opt) => {
                        const active = region === opt.id
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setRegion(opt.id)}
                                className={cn(
                                    "relative px-5 py-2 rounded-full text-sm font-medium transition-colors",
                                    active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {active && (
                                    <motion.span
                                        layoutId="region-pill"
                                        className="absolute inset-0 rounded-full bg-primary shadow-glow"
                                        transition={{ type: "spring", duration: 0.4 }}
                                    />
                                )}
                                <span className="relative">{opt.label}</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            <motion.div
                key={region}
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } }}
                className="grid md:grid-cols-3 gap-4 max-w-6xl mx-auto"
            >
                {plans.map((plan) => (
                    <motion.div
                        key={plan.tier}
                        variants={{
                            hidden: { opacity: 0, y: 32, scale: 0.95 },
                            visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
                        }}
                        className={cn("relative", plan.highlight && "lg:-my-4")}
                    >
                        {plan.highlight && (
                            <Badge variant="neon" className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 shadow-glow">
                                ⚡ MOST POPULAR
                            </Badge>
                        )}

                        {plan.highlight && (
                            <motion.div
                                aria-hidden
                                className="absolute -inset-3 rounded-3xl pointer-events-none opacity-40 -z-10"
                                style={{
                                    background: "conic-gradient(from 0deg, hsl(var(--neon-cyan)), hsl(var(--neon-magenta)), hsl(var(--neon-amber)), hsl(var(--neon-cyan)))",
                                    filter: "blur(28px)",
                                }}
                                animate={{ rotate: 360 }}
                                transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
                            />
                        )}

                        <CardTilt intensity={0.4} className="h-full">
                            <div className={cn(
                                "relative rounded-2xl p-6 h-full flex flex-col",
                                plan.highlight
                                    ? "glass-strong border-2 border-primary/40 shadow-glow-lg bg-border/60 from-primary/10 to-transparent"
                                    : "glass border border-border/50",
                            )}>
                                <div className="mb-5">
                                    <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                                        {plan.name}
                                    </div>
                                    <div className="mt-2 flex items-baseline gap-1">
                                        <span className={cn("text-5xl font-bold tabular-nums", plan.highlight && "text-gradient")}>
                                            {formatPlanPrice(plan)}
                                        </span>
                                        <span className="text-muted-foreground">/mo</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5 flex-wrap">
                                        <Badge variant="outline" className="text-[10px]">
                                            {Number.isFinite(plan.maxBranches)
                                                ? `${plan.maxBranches} outlet${plan.maxBranches > 1 ? "s" : ""}`
                                                : "Unlimited outlets"}
                                        </Badge>
                                        <Badge variant="outline" className="text-[10px]">
                                            {Number.isFinite(plan.maxStaffPerBranch)
                                                ? `${plan.maxStaffPerBranch} staff / outlet`
                                                : "Unlimited staff"}
                                        </Badge>
                                    </div>
                                </div>

                                <Button asChild variant={plan.highlight ? "neon" : "outline"} className="w-full mb-5">
                                    <Link href="/signup">Start free trial</Link>
                                </Button>

                                <ul className="space-y-2 text-sm flex-1">
                                    {plan.features.map((f) => (
                                        <li key={f} className="flex items-start gap-2">
                                            <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
                                            <span className={plan.highlight ? "" : "text-muted-foreground"}>{f}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </CardTilt>
                    </motion.div>
                ))}
            </motion.div>

            <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
                className="text-center text-xs text-muted-foreground mt-10"
            >
                30-day free trial · No credit card required · Cancel anytime · Unlimited staff accounts on every plan
            </motion.p>
        </section>
    )
}

// ============ TESTIMONIALS ============
export function Testimonials() {
    const quotes = [
        {
            name: "Rahul S.",
            role: "Owner, dhaba in Punjab",
            quote: "Mera CA pehle 8000 leta tha har mahine. Ab woh sirf file karta hai aur 2000 leta hai. Pehle din se hi savings.",
        },
        {
            name: "Anita G.",
            role: "Café owner, Bangalore",
            quote: "QR ordering changed our weekend rush. Customers pay via UPI before food is even prepped. No more bill chasing.",
        },
        {
            name: "Karan M.",
            role: "Cloud kitchen, Mumbai",
            quote: "The bill lock + audit log gave my accountant peace of mind. Finally a POS that takes tax seriously.",
        },
        {
            name: "Layla H.",
            role: "Café owner, Dubai",
            quote: "Set it to UAE and the 5% VAT, AED pricing and bills were just… right. The QR ordering paid for itself the first weekend.",
        },
    ]
    return (
        <section className="container mx-auto px-4 py-20 md:py-28">
            <SectionHeading
                kicker="Restaurant owners say"
                prefix="Built for restaurants."
                highlight="Loved worldwide."
                align="center"
                className="mb-12 max-w-2xl"
            />
            <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={{ visible: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } } }}
                className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4"
            >
                {quotes.map((q, i) => (
                    <motion.div
                        key={i}
                        variants={{
                            hidden: { opacity: 0, y: 28, scale: 0.96 },
                            visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
                        }}
                    >
                        <CardTilt intensity={0.4} className="h-full">
                            <div className="rounded-2xl glass border border-border/50 p-6 h-full relative overflow-hidden group">
                                <div className="absolute -top-12 -left-12 h-32 w-32 rounded-full bg-warning/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                                <div className="relative">
                                    <motion.div
                                        initial="hidden"
                                        whileInView="visible"
                                        viewport={{ once: true }}
                                        variants={{ visible: { transition: { staggerChildren: 0.05, delayChildren: 0.2 + i * 0.1 } } }}
                                        className="flex gap-0.5 mb-3"
                                    >
                                        {Array.from({ length: 5 }).map((_, j) => (
                                            <motion.span
                                                key={j}
                                                variants={{
                                                    hidden: { opacity: 0, scale: 0, rotate: -90 },
                                                    visible: {
                                                        opacity: 1, scale: 1, rotate: 0,
                                                        transition: { type: "spring", stiffness: 280, damping: 14 },
                                                    },
                                                }}
                                            >
                                                <Star className="h-4 w-4 fill-warning text-warning" />
                                            </motion.span>
                                        ))}
                                    </motion.div>
                                    <p className="text-sm leading-relaxed mb-4">&ldquo;{q.quote}&rdquo;</p>
                                    <div className="flex items-center gap-3 pt-4 border-t border-border/40">
                                        <div className="grid place-items-center h-9 w-9 rounded-full bg-primary/15 font-semibold text-sm">
                                            {q.name.charAt(0)}
                                        </div>
                                        <div>
                                            <div className="font-medium text-sm">{q.name}</div>
                                            <div className="text-xs text-muted-foreground">{q.role}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardTilt>
                    </motion.div>
                ))}
            </motion.div>
        </section>
    )
}

// ============ FAQ ============
export function FAQ() {
    // Sourced from `@/lib/site` so the visible Q&A and the FAQPage JSON-LD
    // on `/` are always the same content (a Google structured-data rule).
    const items = SITE_FAQ
    const [open, setOpen] = useState<number | null>(0)
    return (
        <section id="faq" className="container mx-auto px-4 py-20 md:py-28">
            <div className="max-w-3xl mx-auto">
                <SectionHeading
                    kicker="FAQ"
                    prefix="Questions?"
                    highlight="Answered."
                    align="center"
                    className="mb-12"
                />
                <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-50px" }}
                    variants={{ visible: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } } }}
                    className="space-y-2"
                >
                    {items.map((it, i) => (
                        <motion.div
                            key={i}
                            variants={{
                                hidden: { opacity: 0, x: -16 },
                                visible: { opacity: 1, x: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
                            }}
                            className="rounded-xl glass border border-border/50 overflow-hidden hover:border-primary/40 transition-colors"
                        >
                            <button
                                onClick={() => setOpen(open === i ? null : i)}
                                className="w-full flex items-center justify-between p-4 text-left font-medium hover:bg-accent/30 transition-colors"
                            >
                                {it.q}
                                <span className={cn("transition-transform shrink-0 ml-3", open === i ? "rotate-45" : "")}>
                                    <span className="block h-4 w-4 relative">
                                        <span className="absolute inset-0 m-auto h-0.5 w-4 bg-current" />
                                        <span className="absolute inset-0 m-auto h-4 w-0.5 bg-current" />
                                    </span>
                                </span>
                            </button>
                            <motion.div
                                initial={false}
                                animate={{ height: open === i ? "auto" : 0, opacity: open === i ? 1 : 0 }}
                                transition={{ duration: 0.25 }}
                                className="overflow-hidden"
                            >
                                <p className="px-4 pb-4 text-sm text-muted-foreground">{it.a}</p>
                            </motion.div>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </section>
    )
}

// ============ FINAL CTA ============
export function FinalCTA() {
    return (
        <section className="container mx-auto px-4 py-20 md:py-28">
            <motion.div
                initial={{ opacity: 0, y: 28, scale: 0.96 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="relative rounded-3xl overflow-hidden glass-strong border border-border/60 p-10 md:p-16 text-center"
            >
                {/* Animated portal rings — a "doorway opening" feel */}
                <PortalRings />

                <div className="absolute inset-0 -z-10">
                    <motion.div
                        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
                        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute top-0 left-1/4 h-72 w-72 rounded-full bg-primary/25 blur-3xl"
                    />
                    <motion.div
                        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                        className="absolute bottom-0 right-1/4 h-72 w-72 rounded-full bg-[hsl(var(--neon-magenta)/0.25)] blur-3xl"
                    />
                </div>

                <div className="relative z-10">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 14 }}
                    >
                        <Badge variant="neon" className="mb-4"><Sparkles className="h-3 w-3 mr-1" /> Ready when you are</Badge>
                    </motion.div>

                    <SectionHeading
                        prefix="Run your restaurant with the same tools as the chains."
                        highlight="For 1/10th the price."
                        align="center"
                        className="max-w-2xl"
                    />

                    <motion.p
                        initial={{ opacity: 0, y: 12 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.6, duration: 0.6 }}
                        className="text-muted-foreground mt-4 max-w-xl mx-auto"
                    >
                        Stop chasing spreadsheets. Stop doing tax by hand. Just run a great restaurant.
                    </motion.p>
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.75, duration: 0.6 }}
                        className="mt-8 flex flex-wrap items-center justify-center gap-3"
                    >
                        <Button asChild variant="neon" size="xl" className="text-base">
                            <Link href="/signup">Start your free trial <ArrowRight className="h-4 w-4" /></Link>
                        </Button>
                        <Button asChild variant="outline" size="xl" className="text-base">
                            <Link href="/login">Sign in</Link>
                        </Button>
                    </motion.div>
                    <p className="text-xs text-muted-foreground mt-4">30-day trial · No credit card · Cancel anytime</p>
                </div>
            </motion.div>
        </section>
    )
}

// ============ FOOTER ============
export function Footer() {
    return (
        <footer className="border-t border-border/40 mt-12">
            <div className="container mx-auto px-4 py-12">
                <div className="grid md:grid-cols-4 gap-8 mb-10">
                    <div className="md:col-span-2">
                        <Link href="/" className="inline-flex items-center gap-2 font-semibold mb-3">
                            <span className="grid place-items-center h-8 w-8 rounded-lg bg-primary text-primary-foreground">
                                <Sparkles className="h-4 w-4" />
                            </span>
                            <span>RestoPOS</span>
                        </Link>
                        <p className="text-sm text-muted-foreground max-w-sm">
                            Cloud Point-of-Sale for restaurants — worldwide. Tax-ready in 30+ countries (GST · VAT · Sales Tax). India: GST-ready, CA-ready.
                        </p>
                    </div>
                    <div>
                        <div className="font-semibold text-sm mb-3">Product</div>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li><Link href="/features" className="hover:text-foreground transition-colors">Features</Link></li>
                            <li><Link href="/features#ca-export" className="hover:text-foreground transition-colors">CA Export</Link></li>
                            <li><Link href="/pricing" className="hover:text-foreground transition-colors">Pricing</Link></li>
                            <li><Link href="/demo" className="hover:text-foreground transition-colors">Book a demo</Link></li>
                        </ul>
                    </div>
                    <div>
                        <div className="font-semibold text-sm mb-3">Get in touch</div>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> hello@restopos.in</li>
                            <li className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> +91 ••••• •••••</li>
                            <li className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> Made in India</li>
                            <li className="flex gap-3 pt-2">
                                <a href="#" className="hover:text-foreground transition-colors"><Globe className="h-4 w-4" /></a>
                                <a href="#" className="hover:text-foreground transition-colors"><MessageCircle className="h-4 w-4" /></a>
                            </li>
                        </ul>
                    </div>
                </div>
                <div className="border-t border-border/40 pt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div>© {new Date().getFullYear()} RestoPOS · Confidential &amp; Proprietary</div>
                    <div className="flex gap-4">
                        <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
                        <a href="#" className="hover:text-foreground transition-colors">Terms</a>
                        <a href="#" className="hover:text-foreground transition-colors">Security</a>
                    </div>
                </div>
            </div>
        </footer>
    )
}
