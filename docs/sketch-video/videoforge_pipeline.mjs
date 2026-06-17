import fs from 'node:fs';
const BASE = 'http://localhost:4000/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TITLE = 'Child Behavior Fun Facts';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dur = (t) => Math.min(20000, Math.max(800, t.split(/\s+/).length * 380));

const scene = (voiceoverText, smallCaption, big, keywords, description) => ({
  voiceoverText, smallCaption, bigCaptionWords: big.split(/\s+/),
  brollSuggestion: { mediaType: 'photo', keywords, description },
  suggestedDurationMs: dur(voiceoverText),
});

const plan = { scenes: [
  scene(
    "Here are five fun-fact behaviors every parent should notice, because they quietly reveal how your child is growing.",
    "5 behaviors to notice", "Five things to notice",
    ["parent", "child", "home"],
    "a warm hand-drawn scene of a parent and a young child sitting together at home, single clear subject"),
  scene(
    "Number one: copying. When your child mimics your words, gestures, or even your phone habits, their brain is learning social behavior by imitation. Notice what they copy most — it shows what they see every day.",
    "1 - They copy you", "They copy you",
    ["child", "imitating", "phone"],
    "a small child imitating a parent talking on a phone, single clear subject, simple background"),
  scene(
    "Number two: asking why, again and again. Those endless why questions are not irritation. They are your child building logic and cause and effect. Don't shut it down. Curiosity is intelligence growing.",
    "2 - Endless why", "Endless why",
    ["curious", "child", "question"],
    "a curious child looking up and asking a question, a thought bubble above, single clear subject"),
  scene(
    "Number three: talking to toys or imaginary friends. This is imagination, language, and emotional processing at work. Listen to their stories. They often reveal fears, wishes, or things they saw.",
    "3 - Pretend play", "Pretend play",
    ["child", "toys", "teddy bear"],
    "a child playing pretend with toys and a teddy bear on the floor, single clear subject"),
  scene(
    "Number four: sudden clinginess. Extra hugs or not wanting to leave you can mean they feel insecure, tired, unwell, or are in a growth phase. Notice the sudden change, not just the behavior.",
    "4 - Sudden clinginess", "Sudden clinginess",
    ["child", "hugging", "parent"],
    "a young child hugging a parent's leg for comfort, single clear subject, soft mood"),
  scene(
    "Number five: meltdowns over small things. A broken biscuit or the wrong cup can feel huge, because their self-control is still developing. A meltdown is usually communication: hunger, tiredness, fear, or too much stimulation.",
    "5 - Big meltdowns", "Big meltdowns",
    ["toddler", "crying", "biscuit"],
    "a toddler crying on the floor over a broken biscuit, single clear subject"),
  scene(
    "The parent rule: don't only notice bad behavior. Notice patterns. A child's behavior is usually a message, before it becomes a problem.",
    "Notice the pattern", "Notice the pattern",
    ["parent", "child", "calm"],
    "a calm parent gently watching and understanding their child, single clear subject"),
]};

const email = `run-${Date.now()}@local.test`;
let r = await fetch(`${BASE}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'videoforge-run-12345' }) });
const auth = await r.json();
const token = auth.accessToken;
if (!token) { log('SIGNUP FAILED', r.status, JSON.stringify(auth)); process.exit(1); }
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
log('signup ok;', plan.scenes.length, 'scenes (hand-authored)');

r = await fetch(`${BASE}/script/generate`, { method: 'POST', headers: H, body: JSON.stringify({ title: TITLE, plan, voiceId: 'af_heart', withMusic: true, sketchStyle: 'pen' }) });
const gen = await r.json();
log('generate', r.status, JSON.stringify(gen));

let projectId = gen.projectId || null;
const genDeadline = Date.now() + 20 * 60 * 1000;
while (!projectId && Date.now() < genDeadline) {
  await sleep(6000);
  const pr = await fetch(`${BASE}/projects`, { headers: H });
  const list = await pr.json();
  const items = Array.isArray(list) ? list : (list.projects || list.items || []);
  const found = items.find((p) => (p.name || p.title) === TITLE);
  if (found) projectId = found.id;
  process.stdout.write('.');
}
console.log('');
if (!projectId) { log('GENERATION TIMED OUT'); process.exit(1); }
log('PROJECT READY:', projectId);

r = await fetch(`${BASE}/exports`, { method: 'POST', headers: H, body: JSON.stringify({ projectId }) });
const ex = await r.json();
log('export create', r.status, JSON.stringify(ex).slice(0, 300));
const exportId = ex.id || ex.exportId || ex.export?.id || ex.jobId;
if (!exportId) process.exit(1);

const exDeadline = Date.now() + 15 * 60 * 1000;
let dl = null, st = null;
while (Date.now() < exDeadline) {
  await sleep(5000);
  const sr = await fetch(`${BASE}/exports/${exportId}`, { headers: H });
  const s = await sr.json();
  st = s.status || s.state;
  dl = s.downloadUrl || s.url || s.download || s.outputUrl || s.signedUrl || null;
  process.stdout.write(`[${st}]`);
  if (dl) break;
  if (st && /fail|error/i.test(st)) { log('EXPORT FAILED', JSON.stringify(s).slice(0, 500)); process.exit(1); }
}
console.log('');
if (!dl) { log('NO DOWNLOAD URL; status:', st); process.exit(1); }
const url = dl.replace('http://minio:9000', 'http://localhost:9000');
const fr = await fetch(url);
fs.writeFileSync('/tmp/vf-run/output.mp4', Buffer.from(await fr.arrayBuffer()));
log('DONE → /tmp/vf-run/output.mp4', (fs.statSync('/tmp/vf-run/output.mp4').size / 1048576).toFixed(2), 'MB');
