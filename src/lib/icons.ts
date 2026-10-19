// Shared inlined SVG icons. The raw SVGs are imported from src/assets/icons so they
// are bundled into JS (no runtime fetch, works offline) and recolored via currentColor.
import sunIcon from "../assets/icons/sun-solid-full.svg?raw";
import dropletIcon from "../assets/icons/droplet-solid-full.svg?raw";
import skullIcon from "../assets/icons/skull-solid-full.svg?raw";
import fireIcon from "../assets/icons/fire-solid-full.svg?raw";
import treeIcon from "../assets/icons/tree-solid-full.svg?raw";
import boltIcon from "../assets/icons/bolt-solid-full.svg?raw";
import clockIcon from "../assets/icons/clock-regular-full.svg?raw";
import githubIcon from "../assets/icons/github-brands-solid-full.svg?raw";
import arrowUpFromBracketIcon from "../assets/icons/arrow-up-from-bracket-solid-full.svg?raw";
import floppyDiskIcon from "../assets/icons/floppy-disk-solid-full.svg?raw";
import banIcon from "../assets/icons/ban-solid-full.svg?raw";
import triangleExclamationIcon from "../assets/icons/triangle-exclamation-solid-full.svg?raw";
import cloneIcon from "../assets/icons/clone-solid-full.svg?raw";
import calendarXmarkIcon from "../assets/icons/calendar-xmark-solid-full.svg?raw";
import boxArchiveIcon from "../assets/icons/box-archive-solid-full.svg?raw";
import arrowDownAZIcon from "../assets/icons/arrow-down-a-z-solid-full.svg?raw";
import listIcon from "../assets/icons/list-solid-full.svg?raw";
import borderAllIcon from "../assets/icons/border-all-solid-full.svg?raw";
import ellipsisVerticalIcon from "../assets/icons/ellipsis-vertical-solid-full.svg?raw";
import checkIcon from "../assets/icons/check-solid-full.svg?raw";
import arrowsRotateIcon from "../assets/icons/arrows-rotate-solid-full.svg?raw";
import clipboardCheckIcon from "../assets/icons/clipboard-check-solid-full.svg?raw";
import xmarkIcon from "../assets/icons/xmark-solid-full.svg?raw";
import circleQuestionIcon from "../assets/icons/circle-question-solid-full.svg?raw";
import cameraIcon from "../assets/icons/camera-solid-full.svg?raw";

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

// Verification history clock (Font Awesome "clock", regular full)
export const clockIconSvg = inlineIcon(clockIcon);

// GitHub brand mark (Font Awesome "github", brands solid full)
export const githubIconSvg = inlineIcon(githubIcon);

// General UI icons (Font Awesome Free 7.3.1, "full" solid variants)
export const importIconSvg = inlineIcon(arrowUpFromBracketIcon); // arrow-up-from-bracket
export const saveLogIconSvg = inlineIcon(floppyDiskIcon); // floppy-disk
export const banIconSvg = inlineIcon(banIcon); // ban
export const warningIconSvg = inlineIcon(triangleExclamationIcon); // triangle-exclamation
export const cloneIconSvg = inlineIcon(cloneIcon); // clone (stacked copies)
export const calendarXmarkIconSvg = inlineIcon(calendarXmarkIcon); // calendar-xmark
export const archiveIconSvg = inlineIcon(boxArchiveIcon); // box-archive
export const sortAZIconSvg = inlineIcon(arrowDownAZIcon); // arrow-down-a-z
export const listIconSvg = inlineIcon(listIcon); // list
export const gridIconSvg = inlineIcon(borderAllIcon); // border-all (2x2 quadrants)
export const ellipsisIconSvg = inlineIcon(ellipsisVerticalIcon); // ellipsis-vertical
export const checkIconSvg = inlineIcon(checkIcon); // check
export const flipIconSvg = inlineIcon(arrowsRotateIcon); // arrows-rotate
export const clipboardCheckIconSvg = inlineIcon(clipboardCheckIcon); // clipboard-check
export const xmarkIconSvg = inlineIcon(xmarkIcon); // xmark
export const questionCircleIconSvg = inlineIcon(circleQuestionIcon); // circle-question
export const cameraIconSvg = inlineIcon(cameraIcon); // camera