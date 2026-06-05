export const meta = {
  name: 'build-loop',
  description: 'VideoForge build loop: scope → design → build → test/verify → review for one feature',
  whenToUse: 'Run when the CEO/Atlas wants a feature taken through the full develop→test→refactor loop with persona separation.',
  phases: [
    { title: 'Scope' },
    { title: 'Design' },
    { title: 'Build' },
    { title: 'Verify' },
    { title: 'Review' },
  ],
}

// args = the feature/task description (a string). Falls back to a prompt if missing.
const feature = (typeof args === 'string' && args) ? args : (args?.feature ?? 'UNSPECIFIED FEATURE — ask the CEO')

const SCOPE_SCHEMA = {
  type: 'object',
  required: ['inScope', 'acceptanceCriteria', 'touchesInvariant', 'hasUI', 'surfaces'],
  properties: {
    inScope: { type: 'boolean', description: 'Is this within docs/MVP_Scope.md ✅ items?' },
    reason: { type: 'string' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    touchesInvariant: { type: 'boolean', description: 'Touches project-schema / ffmpeg-graph parity?' },
    hasUI: { type: 'boolean' },
    surfaces: { type: 'array', items: { type: 'string', enum: ['web', 'api', 'render'] } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'evidence'],
  properties: {
    verdict: { type: 'string', enum: ['SHIP', 'BLOCK'] },
    evidence: { type: 'string', description: 'Commands run + results' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}

phase('Scope')
const scope = await agent(
  `As Vera (Head of Product), assess this feature for VideoForge: "${feature}". ` +
  `Read docs/MVP_Scope.md. Decide if it is in scope (only ✅ items). Return acceptance criteria, ` +
  `whether it touches the WYCIWYG invariant (project-schema/ffmpeg-graph), whether it has UI, and ` +
  `which surfaces it touches (web/api/render).`,
  { label: 'vera:scope', phase: 'Scope', agentType: 'vera', schema: SCOPE_SCHEMA }
)

if (!scope || !scope.inScope) {
  log(`🧭 OUT OF SCOPE — escalate to CEO. Reason: ${scope?.reason ?? 'scope check failed'}`)
  return { stopped: 'scope-gate', feature, scope }
}

phase('Design')
let design = null
if (scope.hasUI) {
  design = await agent(
    `As Iris (Head of Design), produce a concise design brief for "${feature}" in VideoForge. ` +
    `Honor brand rules: dark-first, amber #FF7A1A for the Export CTA only, sky-blue selection, no ` +
    `Canva purple, pro-NLE feel. Give Pixel implementable specs (states, tokens, behavior). ` +
    `Acceptance criteria: ${JSON.stringify(scope.acceptanceCriteria)}.`,
    { label: 'iris:design', phase: 'Design', agentType: 'iris' }
  )
}

phase('Build')
const ENGINEER = { web: 'pixel', api: 'core', render: 'reel' }
const built = await parallel(scope.surfaces.map((surface) => () =>
  agent(
    `As ${ENGINEER[surface]}, implement the ${surface} part of "${feature}" in VideoForge. ` +
    `Acceptance criteria: ${JSON.stringify(scope.acceptanceCriteria)}. ` +
    (design ? `Design brief: ${design}\n` : '') +
    (scope.touchesInvariant ? `This touches the WYCIWYG invariant — keep preview/export parity; run golden tests.\n` : '') +
    `Run typecheck + lint + relevant tests. Report what changed and how you verified it.`,
    { label: `build:${surface}`, phase: 'Build', agentType: ENGINEER[surface] }
  )
))

phase('Verify')
const verdict = await agent(
  `As Sentinel (QA), verify the work for "${feature}". Run: pnpm typecheck, pnpm lint, pnpm test` +
  (scope.touchesInvariant ? `, pnpm test:golden, pnpm test:perf` : ``) +
  `, and the relevant e2e. Return SHIP or BLOCK with the commands run and their results. ` +
  `Build summary: ${JSON.stringify(built.filter(Boolean))}`,
  { label: 'sentinel:verify', phase: 'Verify', agentType: 'sentinel', schema: VERDICT_SCHEMA }
)

phase('Review')
const review = await agent(
  `As Forge (Principal Engineer), review the change for "${feature}": correctness, simplicity, ` +
  `reuse, and ${scope.touchesInvariant ? 'INVARIANT-SAFETY (project-schema ↔ ffmpeg-graph parity)' : 'pattern-fit'}. ` +
  `Sentinel verdict: ${JSON.stringify(verdict)}. Give approve / changes-needed with specifics.`,
  { label: 'forge:review', phase: 'Review', agentType: 'forge' }
)

return { feature, scope, design, built: built.filter(Boolean), verdict, review }
