import { addons } from "storybook/manager-api"

import { restoposTheme } from "./restopos-theme"

/**
 * Storybook manager (sidebar, top bar, addons panel) chrome.
 *
 * Pinned to the same dark palette the canvas uses so the UI doesn't switch
 * between a bright white manager and a dark app preview every time you click
 * a story. See `.storybook/restopos-theme.ts` for the palette source.
 */
addons.setConfig({
    theme: restoposTheme,
})
