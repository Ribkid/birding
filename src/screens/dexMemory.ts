// What the Dex remembers, for the session, about how she left it: each group's height and which groups were on or
// near the screen. Coming back to the same place (Back from a species page) then lays the dex out exactly as she left
// it, so the remembered scroll lands on the same tile, and draws the groups around her first.

/** A group as she left it: its key, where it sat against the screen, its height and the part of it that is padding. */
export interface LeftGroup { key: string; top: number; bottom: number; height: number; padding: number }
interface Left { near: Set<string>; y: number }

const contentHeights = new Map<string, number>();
const boxHeights = new Map<string, number>();
const leftAt = new Map<string, Left>();

/** A group's heights depend on which group it is, the layout, how many species it shows and the screen's width. */
export const groupKey = (group: string, layout: string, n: number, width = innerWidth) => `${group}|${layout}|${n}|${width}`;

/** The height of a group's content (for contain-intrinsic-size, which the padding goes on top of), if known. */
export const rememberedContent = (key: string) => contentHeights.get(key);
/** A group's whole height, padding and all, if known. */
export const rememberedBox = (key: string) => boxHeights.get(key);

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * On leaving the dex drawn for history entry `entry`, scrolled to `y` on a screen `vh` high: every group's heights,
 * and the groups within two screens of the one she was looking at.
 */
export function rememberLeaving(entry: string, groups: LeftGroup[], y: number, vh: number) {
  const near = new Set<string>();
  for (const g of groups) {
    if (!g.height) continue;
    boxHeights.set(g.key, round(g.height));
    if (g.height - g.padding > 0) contentHeights.set(g.key, round(g.height - g.padding));
    if (g.bottom > -2 * vh && g.top < 3 * vh) near.add(g.key);
  }
  leftAt.set(entry, { near, y });
}

/**
 * The groups to draw first when the dex for history entry `entry` is drawn and will land at scroll `landing` (null
 * when it is not being returned to): those she left on or near the screen, if it lands where she left it. Null means
 * draw every group at once.
 */
export function drawFirst(entry: string, landing: number | null): Set<string> | null {
  const left = leftAt.get(entry);
  return left && landing != null && Math.abs(landing - left.y) < 1 && left.near.size ? left.near : null;
}

/** Forget everything (tests). */
export function forgetDex() {
  contentHeights.clear();
  boxHeights.clear();
  leftAt.clear();
}
