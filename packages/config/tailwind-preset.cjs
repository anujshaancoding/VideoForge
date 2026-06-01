/**
 * @videoforge/config — Tailwind preset
 *
 * Maps the VideoForge `--vf-*` design tokens (Design_Instructions_MVP.md §2) onto the
 * Tailwind theme as CSS-variable references. apps/web extends this preset and is
 * responsible for emitting the actual token *values* on :root (see the :root block in
 * Design_Instructions_MVP.md §2 / the contract). Mapping to var(--vf-*) here means a
 * re-skin is "replace the CSS vars," not a Tailwind config rewrite.
 *
 * Dark-theme-first. The amber accent (--vf-accent) is the single primary CTA (Export)
 * color only — never routine selection (that is functional sky-blue --vf-selection).
 *
 * Usage in apps/web tailwind.config.cjs:
 *   module.exports = {
 *     presets: [require('@videoforge/config/tailwind-preset')],
 *     content: ['./index.html', './src/** /*.{ts,tsx}'],
 *   };
 *
 * @type {import('tailwindcss').Config}
 */
const preset = {
  // Dark-first: the editor is always dark; toggling is not in MVP scope.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        vf: {
          // ── §2.1 Neutral surfaces & elevation ──
          'bg-app': 'var(--vf-bg-app)',
          'surface-canvas-surround': 'var(--vf-surface-canvas-surround)',
          'surface-1': 'var(--vf-surface-1)',
          'surface-2': 'var(--vf-surface-2)',
          'surface-3': 'var(--vf-surface-3)',
          'surface-4': 'var(--vf-surface-4)',
          'surface-sunken': 'var(--vf-surface-sunken)',
          'border-subtle': 'var(--vf-border-subtle)',
          'border-default': 'var(--vf-border-default)',
          'border-strong': 'var(--vf-border-strong)',
          'overlay-scrim': 'var(--vf-overlay-scrim)',

          // ── §2.2 Text & icon ──
          'text-primary': 'var(--vf-text-primary)',
          'text-secondary': 'var(--vf-text-secondary)',
          'text-tertiary': 'var(--vf-text-tertiary)',
          'text-disabled': 'var(--vf-text-disabled)',
          'text-inverse': 'var(--vf-text-inverse)',
          'icon-default': 'var(--vf-icon-default)',
          'icon-muted': 'var(--vf-icon-muted)',

          // ── §2.3 Brand & accent (molten ember — primary CTA only) ──
          accent: 'var(--vf-accent)',
          'accent-hover': 'var(--vf-accent-hover)',
          'accent-active': 'var(--vf-accent-active)',
          'accent-subtle': 'var(--vf-accent-subtle)',
          'accent-text': 'var(--vf-accent-text)',
          'accent-secondary': 'var(--vf-accent-secondary)',

          // ── §2.4 Semantic status (always paired with an icon + label) ──
          'success-fg': 'var(--vf-success-fg)',
          'success-bg': 'var(--vf-success-bg)',
          'success-subtle': 'var(--vf-success-subtle)',
          'warning-fg': 'var(--vf-warning-fg)',
          'warning-bg': 'var(--vf-warning-bg)',
          'warning-subtle': 'var(--vf-warning-subtle)',
          'danger-fg': 'var(--vf-danger-fg)',
          'danger-bg': 'var(--vf-danger-bg)',
          'danger-subtle': 'var(--vf-danger-subtle)',
          'info-fg': 'var(--vf-info-fg)',
          'info-bg': 'var(--vf-info-bg)',
          'info-subtle': 'var(--vf-info-subtle)',

          // ── §2.5 Editor / timeline functional colors ──
          selection: 'var(--vf-selection)',
          'selection-halo': 'var(--vf-selection-halo)',
          playhead: 'var(--vf-playhead)',
          'snap-line': 'var(--vf-snap-line)',
          marker: 'var(--vf-marker)',
          workarea: 'var(--vf-workarea)',
          'track-grid': 'var(--vf-track-grid)',
          'ruler-tick': 'var(--vf-ruler-tick)',

          // ── §2.5 Track-type colors (hue always paired with icon + name) ──
          'track-video': 'var(--vf-track-video)',
          'track-video-fill': 'var(--vf-track-video-fill)',
          'track-video-fill-selected': 'var(--vf-track-video-fill-selected)',
          'track-audio': 'var(--vf-track-audio)',
          'track-audio-fill': 'var(--vf-track-audio-fill)',
          'track-audio-fill-selected': 'var(--vf-track-audio-fill-selected)',
          'track-audio-waveform': 'var(--vf-track-audio-waveform)',
          'track-caption': 'var(--vf-track-caption)',
          'track-caption-fill': 'var(--vf-track-caption-fill)',
          'track-caption-fill-selected': 'var(--vf-track-caption-fill-selected)',
          'track-overlay': 'var(--vf-track-overlay)',
          'track-overlay-fill': 'var(--vf-track-overlay-fill)',
          'track-overlay-fill-selected': 'var(--vf-track-overlay-fill-selected)',
          'track-voiceover': 'var(--vf-track-voiceover)',
        },
      },

      // ── §2.6 Typography ──
      fontFamily: {
        sans: 'var(--vf-font-sans)',
        mono: 'var(--vf-font-mono)',
        display: 'var(--vf-font-display)',
      },
      fontSize: {
        // [size, { lineHeight, letterSpacing }] — values match §2.6 type scale.
        '2xs': ['0.6875rem', { lineHeight: '1.3', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        sm: ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0' }],
        base: ['0.875rem', { lineHeight: '1.55', letterSpacing: '0' }],
        md: ['1rem', { lineHeight: '1.5', letterSpacing: '0' }],
        lg: ['1.25rem', { lineHeight: '1.4', letterSpacing: '-0.005em' }],
        xl: ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        '2xl': ['2rem', { lineHeight: '1.2', letterSpacing: '-0.015em' }],
        '3xl': ['2.5rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
      },
      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
      },

      // ── §2.7 Spacing (px → rem; the free scale, layout constants are pinned separately) ──
      spacing: {
        0: '0',
        0.5: '0.125rem', // 2px
        1: '0.25rem', // 4px
        2: '0.5rem', // 8px
        3: '0.75rem', // 12px
        4: '1rem', // 16px
        5: '1.25rem', // 20px
        6: '1.5rem', // 24px
        8: '2rem', // 32px
        10: '2.5rem', // 40px
        12: '3rem', // 48px
        // Pinned layout constants from §2.1 (not part of the free scale).
        'topbar': '56px',
        'transport': '48px',
        'statusbar': '28px',
        'track-header': '180px',
        'panel-left': '280px',
        'panel-right': '300px',
        'timeline': '260px',
      },

      // ── §2.8 Radii ──
      borderRadius: {
        none: '0',
        xs: '2px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        pill: '999px',
        full: '50%',
      },
    },
  },
  plugins: [],
};

module.exports = preset;
