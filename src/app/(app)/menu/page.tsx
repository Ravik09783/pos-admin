import { redirect } from "next/navigation"

import { getCurrentUserAndTenant } from "@/lib/auth/current-user"
import { MenuCards } from "@/components/app-shell/menu-cards"
import { PageHeader } from "@/components/app-shell/page-header"

/**
 * /menu — the app launcher.
 *
 * The card grid that replaced the old left sidebar. The topbar's "Menu"
 * button links here from anywhere in the app, so a cashier inside POS / KDS
 * can still jump to any other screen.
 *
 * Layout: a role-aware "Quick access" strip up top (the screens this role
 * opens every shift), then the full app grouped by section. Role + per-user
 * template filter happen inside MenuCards via useMyPermissions, so cards
 * only show what the signed-in user is actually allowed to do.
 *
 * (Note: this URL used to belong to the menu-items / catalog editor. That
 * page now lives at /menu-admin — the card on this launcher labelled "Menu"
 * still routes there, so the cashier's mental model — "Menu = food items" —
 * is unchanged.)
 */
export default async function MenuLauncherPage() {
    const { user, appUser } = await getCurrentUserAndTenant()
    if (!user) redirect("/login")
    if (!appUser?.tenant_id) redirect("/onboarding")

    const firstName = appUser.full_name?.split(/\s+/)[0] ?? null

    return (
        <div className="container mx-auto py-6 md:py-8 px-4 max-w-7xl space-y-6">
            <PageHeader
                kicker="App"
                title={firstName ? `Hi, ${firstName}` : "Menu"}
                highlight="what's next?"
                description="Your most-used tools are pinned up top. Everything else is grouped below."
            />
            <MenuCards />
        </div>
    )
}
