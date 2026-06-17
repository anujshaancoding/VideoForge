import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Mock the Script Studio client so the plan step resolves to a deterministic heuristic
// plan (no backend / no API key) — this exercises the "draft plan" review render.
const { planScript, generateScript } = vi.hoisted(() => ({
  planScript: vi.fn(),
  generateScript: vi.fn(),
}));
vi.mock('../../lib/scriptStudio.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/scriptStudio.js')>(
    '../../lib/scriptStudio.js',
  );
  return { ...actual, planScript, generateScript };
});

// The route imports wsClient (connect/disconnect on mount); jsdom has no WebSocket,
// but wsClient swallows that — no mock needed.

import ScriptStudio from '../ScriptStudio.js';

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={['/script']}>
      <ScriptStudio />
    </MemoryRouter>,
  );
}

const HEURISTIC_PLAN = {
  plan: {
    scenes: [
      {
        voiceoverText: 'A lone hiker reaches the summit at dawn.',
        smallCaption: 'Reaching the summit',
        bigCaptionWords: ['lone', 'hiker', 'reaches', 'summit'],
        brollSuggestion: {
          mediaType: 'video' as const,
          keywords: ['hiker', 'summit', 'dawn'],
          description: 'a video of: hiker, summit, dawn',
        },
        suggestedDurationMs: 4000,
      },
      {
        voiceoverText: 'The city wakes up below.',
        smallCaption: 'The city below',
        bigCaptionWords: ['city', 'wakes', 'below'],
        brollSuggestion: {
          mediaType: 'photo' as const,
          keywords: ['city', 'morning'],
          description: 'a photo of: city, morning',
        },
        suggestedDurationMs: 2500,
      },
    ],
  },
  source: 'heuristic' as const,
};

beforeEach(() => {
  planScript.mockReset();
  generateScript.mockReset();
  planScript.mockResolvedValue(HEURISTIC_PLAN);
});

describe('ScriptStudio — plan review', () => {
  it('plans a pasted script and renders an editable, labelled scene plan', async () => {
    const user = userEvent.setup();
    renderStudio();

    // Step 1: paste + plan.
    await user.type(screen.getByTestId('script-input'), 'A lone hiker reaches the summit at dawn.');
    await user.click(screen.getByTestId('plan-btn'));

    // Step 2: the review renders one row per scene.
    const rows = await screen.findAllByTestId('scene-row');
    expect(rows).toHaveLength(2);

    // The "draft plan" label shows because source === 'heuristic'.
    expect(screen.getByTestId('draft-plan-badge')).toBeInTheDocument();

    // Scene 1 surfaces the shot brief (mediaType + keywords + description).
    const first = within(rows[0]!);
    expect(first.getByDisplayValue('A lone hiker reaches the summit at dawn.')).toBeInTheDocument();
    expect(first.getByText('a video of: hiker, summit, dawn')).toBeInTheDocument();
    expect(first.getByText('hiker')).toBeInTheDocument();
    expect(first.getByText(/Shot you need · video/)).toBeInTheDocument();

    // Small + big caption fields are editable inputs pre-filled from the plan.
    expect(first.getByDisplayValue('Reaching the summit')).toBeInTheDocument();
    expect(first.getByDisplayValue('lone hiker reaches summit')).toBeInTheDocument();

    // Scene 2 is a photo brief.
    expect(within(rows[1]!).getByText(/Shot you need · photo/)).toBeInTheDocument();
  });

  it('lets the user edit voiceover text in the plan', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.type(screen.getByTestId('script-input'), 'A lone hiker reaches the summit at dawn.');
    await user.click(screen.getByTestId('plan-btn'));

    const rows = await screen.findAllByTestId('scene-row');
    const vo = within(rows[0]!).getByTestId('scene-voiceover');
    await user.clear(vo);
    await user.type(vo, 'Edited narration line.');
    expect(vo).toHaveValue('Edited narration line.');
  });

  it('disables the plan button until a script is entered', async () => {
    renderStudio();
    expect(screen.getByTestId('plan-btn')).toBeDisabled();
  });

  it('toggles background music in the review step', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.type(screen.getByTestId('script-input'), 'A lone hiker reaches the summit.');
    await user.click(screen.getByTestId('plan-btn'));
    await screen.findAllByTestId('scene-row');

    const music = screen.getByTestId('music-toggle') as HTMLInputElement;
    expect(music.checked).toBe(true); // on by default (auto-duck)
    await user.click(music);
    expect(music.checked).toBe(false);
  });
});
