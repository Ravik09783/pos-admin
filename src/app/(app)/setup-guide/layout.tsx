import { ReactNode } from "react"

/**
 * Layout for the /setup-guide tree. The (app)/layout above already
 * provides the sidebar + topbar; we just give the guide pages an
 * uncluttered max-width column for the step cards.
 */
export default function SetupGuideLayout({ children }: { children: ReactNode }) {
    // Wider container (max-w-4xl) gives the new hero + outcomes-strip
    // layout room to breathe without feeling sparse. The step timeline
    // still reads as a focused column at the centre — the connector
    // and badges stay aligned because they're positioned inside each
    // StepCard, not the container.
    return <div className="container mx-auto py-6 md:py-10 px-4 max-w-4xl">{children}</div>
}
