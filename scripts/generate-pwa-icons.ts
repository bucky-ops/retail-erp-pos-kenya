/**
 * One-off PWA icon generator - renders the DukaMark favicon.svg into every
 * PNG size the manifest needs (incl. maskable + apple-touch-icon).
 * Run: bun run scripts/generate-pwa-icons.ts
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

const SRC = readFileSync("public/favicon.svg", "utf8");

// Standard full-bleed icons: the SVG already fills its rounded square.
async function render(size: number, svg: string, out: string) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`✓ ${out} (${size}×${size})`);
}

// Maskable: mark shrunk into the 80% safe zone over a solid navy canvas.
const maskableSvg = (size: number) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#172B4D"/>
  <g transform="translate(56.32,56.32) scale(12.48)">
    ${SRC.replace("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\">", "")
      .replace("</svg>", "")
      .replace("<rect width=\"32\" height=\"32\" rx=\"7\" fill=\"#0052CC\"/>", "")}
  </g>
</svg>`.replace(/\s+/g, " ");

async function main() {
  await render(512, SRC, "public/icons/icon-512.png");
  await render(192, SRC, "public/icons/icon-192.png");
  await render(180, SRC, "public/icons/apple-touch-icon.png");
  await render(512, maskableSvg(512), "public/icons/maskable-512.png");
  await render(32, SRC, "public/icons/favicon-32.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
