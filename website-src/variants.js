// Items that come in several colours (wings and pets): one card, and you pick the colour. Each colour is its own
// design id (that is what is worn, synced and drawn); the first colour is the item's main id. Owning one colour owns
// them all. The same list is in the mod (Variants.java) and on the server (VARIANTS in main.py).
import GROUPS from "./variants.json";

const kindKey = (kind) => (kind === "pets" ? "pet" : kind);
const BY_ID = {};
const BY_MAIN = {};
for (const [kind, groups] of Object.entries(GROUPS)) {
  for (const g of groups) {
    const group = { kind, main: g.id, name: g.name, colors: g.colors };
    BY_MAIN[kind + ":" + g.id] = group;
    for (const c of g.colors) BY_ID[kind + ":" + c.id] = group;
  }
}

/** The group this design is a colour of, or undefined. */
export function groupOf(kind, id) {
  return BY_ID[kindKey(kind) + ":" + id];
}

/** A colour that shows on another item's card, not as an item of its own. */
export function isExtraColor(kind, id) {
  const g = groupOf(kind, id);
  return !!g && g.main !== id;
}

/** The card's name: the group's name for an item with colours. */
export function titleOf(kind, id, fallback) {
  const g = BY_MAIN[kindKey(kind) + ":" + id];
  return g ? g.name : fallback;
}

/** Which colour of the item `main` to show: the worn one if it is one of its colours, else the main one. */
export function shownColor(kind, main, worn) {
  const g = groupOf(kind, worn);
  return g && g.main === main ? worn : main;
}

/** Every id of the item's group (just the id when it has no other colours). */
export function idsOf(kind, id) {
  const g = groupOf(kind, id);
  return g ? g.colors.map((c) => c.id) : [id];
}
