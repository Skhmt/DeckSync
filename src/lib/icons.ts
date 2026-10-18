// Shared inlined SVG icons. The raw SVGs are imported from src/assets/icons so they
// are bundled into JS (no runtime fetch, works offline) and recolored via currentColor.
import sunIcon from "../assets/icons/sun-solid-full.svg?raw";
import dropletIcon from "../assets/icons/droplet-solid-full.svg?raw";
import skullIcon from "../assets/icons/skull-solid-full.svg?raw";
import fireIcon from "../assets/icons/fire-solid-full.svg?raw";
import treeIcon from "../assets/icons/tree-solid-full.svg?raw";
import boltIcon from "../assets/icons/bolt-solid-full.svg?raw";

/**
 * Prepare an inlined SVG string for use with {@html}:
 * - fill="currentColor" so the icon picks up the surrounding CSS text color
 * - width/height 100% so it fills its container box
 * - optional scale to compensate for the glyph's built-in viewBox padding
 */
export function inlineIcon(raw: string, scale?: number): string {
  const style = scale ? ` style="transform:scale(${scale})"` : "";
  return raw.replace("<svg ", `<svg fill="currentColor" width="100%" height="100%"${style} `);
}

// MTG color identity pips: W=sun, U=droplet, B=skull, R=fire, G=tree.
// Scales compensate for each glyph's viewBox padding so all pips fill the circle evenly.
export const colorIcons: Record<string, string> = {
  W: inlineIcon(sunIcon, 1.06), // sun spans ~90% of its viewBox
  U: inlineIcon(dropletIcon, 1.15), // droplet is tall (~82%)
  B: inlineIcon(skullIcon, 1.19), // skull spans ~80%
  R: inlineIcon(fireIcon, 1.13), // flame is ~84% tall
  G: inlineIcon(treeIcon, 1.06), // tree spans ~90%
};

// Game changer lightning bolt (Font Awesome "bolt", solid full)
export const boltIconSvg = inlineIcon(boltIcon);