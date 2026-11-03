// Copies the Open Design component stylesheet into the app without its @import
// lines (fonts and layout primitives are imported directly by app/globals.css,
// because nested relative @imports don't resolve once inlined).
// Run after re-exporting from Open Design:  npm run design:sync
import { readFileSync, writeFileSync } from "node:fs";

const source = "design/prototypes/assets/app.css";
const target = "app/design-components.generated.css";
const css = readFileSync(source, "utf8").replace(/^@import[^;]*;\s*/gm, "");
writeFileSync(
  target,
  `/* GENERATED from ${source} by scripts/sync-design-css.mjs: do not edit by hand.\n   Change the design in Open Design, re-export, then run \`npm run design:sync\`. */\n${css}`,
);
console.log(`Wrote ${target}`);
