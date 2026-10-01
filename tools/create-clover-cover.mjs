import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const markPath = path.join(root, "public", "brand", "vanteloq-mark.png");
const outputPath = path.join(root, "public", "brand", "clover-app-cover.png");
const mark = (await fs.readFile(markPath)).toString("base64");

const svg = `
<svg width="1080" height="216" viewBox="0 0 1080 216" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#06152b"/>
      <stop offset="0.52" stop-color="#0a2f68"/>
      <stop offset="1" stop-color="#0878f9"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7cc8ff" stop-opacity="0.15"/>
      <stop offset="0.58" stop-color="#9bd8ff" stop-opacity="0.88"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.34"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#65b7ff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#65b7ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#00122b" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="1080" height="216" rx="0" fill="url(#bg)"/>
  <circle cx="920" cy="18" r="240" fill="url(#glow)"/>
  <path d="M720 162 C765 139 795 154 835 116 C871 82 901 102 938 63 C963 37 996 40 1046 28" fill="none" stroke="url(#line)" stroke-width="3"/>
  <path d="M720 179 C770 165 808 174 846 146 C889 114 921 127 959 99 C994 73 1022 81 1062 52" fill="none" stroke="#b7e2ff" stroke-opacity="0.17" stroke-width="1.5"/>
  <g opacity="0.92">
    <rect x="706" y="30" width="329" height="150" rx="24" fill="#ffffff" fill-opacity="0.065" stroke="#ffffff" stroke-opacity="0.20"/>
    <rect x="741" y="118" width="16" height="32" rx="8" fill="#8fcfff" fill-opacity="0.55"/>
    <rect x="773" y="98" width="16" height="52" rx="8" fill="#8fcfff" fill-opacity="0.68"/>
    <rect x="805" y="72" width="16" height="78" rx="8" fill="#ffffff" fill-opacity="0.82"/>
  </g>
  <g filter="url(#shadow)">
    <rect x="44" y="37" width="142" height="142" rx="36" fill="#ffffff" fill-opacity="0.96"/>
    <image href="data:image/png;base64,${mark}" x="73" y="57" width="84" height="102" preserveAspectRatio="xMidYMid meet"/>
  </g>
  <text x="226" y="103" fill="#ffffff" font-size="42" font-weight="720" font-family="Inter, Arial, sans-serif" letter-spacing="-1.5">Vanteloq</text>
  <text x="228" y="136" fill="#d8ebff" font-size="18" font-weight="500" font-family="Inter, Arial, sans-serif">Source-aware retail operations and analytics</text>
  <g transform="translate(228 155)">
    <circle cx="5" cy="5" r="4" fill="#71c2ff"/>
    <text x="18" y="10" fill="#bcd8f5" font-size="13" font-weight="600" font-family="Inter, Arial, sans-serif" letter-spacing="0.5">SALES</text>
    <circle cx="94" cy="5" r="4" fill="#71c2ff"/>
    <text x="107" y="10" fill="#bcd8f5" font-size="13" font-weight="600" font-family="Inter, Arial, sans-serif" letter-spacing="0.5">STOCK</text>
    <circle cx="190" cy="5" r="4" fill="#71c2ff"/>
    <text x="203" y="10" fill="#bcd8f5" font-size="13" font-weight="600" font-family="Inter, Arial, sans-serif" letter-spacing="0.5">CASH</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outputPath);
console.log(outputPath);
