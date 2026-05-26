// Pool of short, restaurant-appropriate quotes. The QR-code printer picks
// one per table using a stable hash of the table id, so the same table
// always gets the same quote (re-prints look identical) but adjacent tables
// have different quotes — handy when guests at table 3 lean over to read
// table 4's card.
export interface FoodQuote {
    text: string
    author: string
}

export const FOOD_QUOTES: FoodQuote[] = [
    { text: "Good food is the foundation of genuine happiness.", author: "Auguste Escoffier" },
    { text: "People who love to eat are always the best people.", author: "Julia Child" },
    { text: "First we eat, then we do everything else.", author: "M.F.K. Fisher" },
    { text: "There is no sincerer love than the love of food.", author: "George Bernard Shaw" },
    { text: "Tell me what you eat, and I will tell you what you are.", author: "Brillat-Savarin" },
    { text: "One cannot think well, love well, sleep well, if one has not dined well.", author: "Virginia Woolf" },
    { text: "Cooking is like love — it should be entered into with abandon or not at all.", author: "Harriet Van Horne" },
    { text: "The discovery of a new dish does more for happiness than the discovery of a star.", author: "Brillat-Savarin" },
    { text: "Hunger is the best sauce.", author: "Cervantes" },
    { text: "Laughter is brightest where food is best.", author: "Irish proverb" },
    { text: "After a good dinner one can forgive anybody, even one's own relations.", author: "Oscar Wilde" },
    { text: "Food is symbolic of love when words are inadequate.", author: "Alan D. Wolfelt" },
    { text: "Atithi Devo Bhava — the guest is divine.", author: "Indian saying" },
    { text: "A meal without spice is a story without soul.", author: "Indian saying" },
    { text: "If more of us valued food and cheer above hoarded gold, it would be a merrier world.", author: "J.R.R. Tolkien" },
    { text: "Cooking is at once child's play and adult joy.", author: "Craig Claiborne" },
    { text: "You don't need a silver fork to eat good food.", author: "Paul Prudhomme" },
    { text: "A recipe has no soul. The cook must bring soul to the recipe.", author: "Thomas Keller" },
    { text: "Food brings people together — on many different levels.", author: "Giada De Laurentiis" },
    { text: "The way you cut your meat reflects the way you live.", author: "Confucius" },
    { text: "Eat with joy. Cook with love.", author: "—" },
    { text: "Stressed spelled backwards is desserts.", author: "—" },
    { text: "Good food is good mood.", author: "—" },
    { text: "Spice is the variety of life.", author: "—" },
    { text: "A balanced diet is a samosa in each hand.", author: "—" },
    { text: "Life is short. Order dessert first.", author: "Ernestine Ulmer" },
    { text: "Eating is a necessity, but cooking is an art.", author: "—" },
    { text: "Great food, great mood, great company.", author: "—" },
    { text: "Where there is good food, there is good company.", author: "—" },
    { text: "The secret ingredient is always love.", author: "—" },
    { text: "Slow down. Savour every bite.", author: "—" },
    { text: "Welcome home — your favourite table is ready.", author: "—" },
]

/** Stable string hash — same input → same number, no Math.random. */
function hashString(s: string): number {
    let h = 0
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i)
        h |= 0
    }
    return Math.abs(h)
}

/** Picks a quote deterministically from a stable seed (e.g. table id). */
export function quoteForSeed(seed: string): FoodQuote {
    if (!seed) return FOOD_QUOTES[0]!
    return FOOD_QUOTES[hashString(seed) % FOOD_QUOTES.length]!
}
