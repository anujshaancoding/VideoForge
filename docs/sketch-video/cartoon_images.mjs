import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/anujshaan/Workspace/02_PERSONAL/studio.Zentrix/VideoForge/apps/api/');
const sharp = require('sharp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = '/tmp/vf-run/cartoon169';
fs.mkdirSync(OUT, { recursive: true });

// Scene subjects (from the hand-authored plan) → semi-realistic cartoon, landscape.
const subjects = [
  'a parent and a young child sitting together at home, looking at each other',
  'a small child imitating a parent talking on a phone',
  'a curious child looking up and asking a question, a thought bubble above',
  'a child playing pretend with toys and a teddy bear on the floor',
  'a young child hugging a parent for comfort',
  'a toddler crying on the floor over a broken biscuit',
  'a calm parent gently watching and understanding their child',
];
const STYLE = 'soft cartoon illustration, semi-realistic, gentle cel shading, warm colors, clean linework, friendly storybook style, single clear subject';

async function fetchOne(prompt, seed, dest) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720&seed=${seed}&nologo=true&model=flux`;
    try {
      const r = await fetch(url);
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && buf.byteLength > 5000) { fs.writeFileSync(dest, buf); return buf.byteLength; }
    } catch {}
    await sleep(16000); // rate limit ~1/15s
  }
  return 0;
}

for (let i = 0; i < subjects.length; i++) {
  const prompt = `${subjects[i]}, ${STYLE}`;
  const raw = `${OUT}/scene${i}_base.jpg`;
  const sz = await fetchOne(prompt, 1000 + i, raw);
  if (!sz) { console.log(`scene ${i}: FAILED`); continue; }
  // cover-resize to 1920x1080, mild saturation pop (cartoon = keep color, no sketch filter)
  await sharp(raw).resize(1920, 1080, { fit: 'cover', kernel: 'lanczos3' })
    .modulate({ saturation: 1.12 }).png().toFile(`${OUT}/scene${i}.png`);
  console.log(`scene ${i}: ${sz} bytes -> scene${i}.png`);
  await sleep(16000);
}
console.log('CARTOON DONE');
