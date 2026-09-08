/**
 * tailwind.config.js
 * Single source of truth for design tokens — "Graphite" redesign (ADR-019 rule 1).
 * Implements UX_SPEC-full-redesign-2026-08.md §3 (tokens) and §4 (breakpoints) exactly.
 *
 * Do not add a value here that is not in UX_SPEC §3 — "no ad-hoc values" is Goal 1 of spec.md.
 * CommonJS on purpose: this project has no "type": "module" in package.json, and this file lives
 * beside next.config.js, which already uses module.exports (project convention).
 */

module.exports = {
  content: [
    './pages/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    // ── §4 Breakpoints — exactly 3 named tiers, mobile-first (min-width). ──
    // xl/2xl deliberately removed so they cannot be reached by accident (ADR-019 rule 2).
    // Must equal src/shared/utils/frontend/breakpoints.js's BP export.
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px'
    },
    extend: {
      // ── §3.1 Colour ──────────────────────────────────────────────────────
      // Naming mirrors the CSS custom properties in globals.css 1:1 (minus the `--` prefix and the
      // group's own utility prefix, so classes read naturally: bg-canvas, bg-surface-1, text-primary,
      // text-on-accent, bg-accent, bg-accent-muted, text-pos/neg/warn/info, border-subtle/default/
      // interactive). Values are the exact hex/rgba from UX_SPEC §3.1 — every pair's contrast ratio is
      // pre-computed and recorded there (AC-2).
      colors: {
        // Surfaces (opaque — never rgba over a gradient)
        canvas: '#0A0A0B',          // bg-canvas — page background
        sunken: '#08080A',          // bg-sunken — recessed wells (input interiors, table body, empty states)
        surface: {
          1: '#121214',             // bg-surface-1 — default card / panel
          2: '#1A1A1D',             // bg-surface-2 — raised (hover, nested card, sticky bar)
          3: '#232327'              // bg-surface-3 — floating (dropdown, popover, sheet, modal, selected row)
        },
        // Text
        primary: '#F4F4F5',         // text-primary — body, headings, money figures, input values (17.02:1 / 18.00:1)
        secondary: '#A1A1AA',       // text-secondary — labels, captions, table headers, helper text (7.30:1 / 7.72:1)
        tertiary: '#8A8A93',        // text-tertiary — timestamps, placeholders (5.47:1 / 5.78:1). Dimmest text permitted.
        'on-accent': '#0A0A0B',     // text-on-accent — text/icons on an accent-filled surface only
        // Accent (single brand accent, ≤10% surface coverage — ADR-006 Decision 1, guarded in UX_SPEC §3.1)
        accent: {
          DEFAULT: '#D4A857',       // bg-accent / text-accent / border-accent (8.50:1 on surface-1)
          muted: 'rgba(212,168,87,0.14)' // bg-accent-muted — tint behind an active/selected row only
        },
        // Money semantics — independent of accent, so an accent-hue swap never changes what a number means
        pos: '#4ADE80',              // income, gain, goal met, paid (10.74:1)
        neg: '#F87171',              // expense, overspend, overdue (6.76:1)
        warn: '#FBBF24',             // due soon, threshold approaching (11.21:1)
        info: '#7FB4E8',             // neutral notice, derived/read-only row marker (8.55:1)
        // Structure
        border: {
          subtle: '#232327',        // border-subtle — decorative only (1.19:1, below 3:1 floor)
          DEFAULT: '#2E2E33',       // border / border-default — decorative only (1.39:1, below 3:1 floor)
          default: '#2E2E33',
          interactive: '#6E6E78'    // border-interactive — mandatory on every input/select/checkbox/radio (3.71:1, WCAG 1.4.11)
        }
      },

      // ── §3.2 Typography — fontSize. Stage-4 Foundation-pass amendment (Dashboard Graphite fix-forward
      // pass): this key didn't exist before, so every text-* utility silently fell back to Tailwind's
      // stock scale instead of §3.2's exact values — text-xl compiled to 1.25rem/20px where §3.2
      // specifies 1.375rem/22px, and text-xs computed to 12px at line-height 1.33, below §3.2's 1.4
      // floor (N6). Every <h2> on Dashboard (text-xl font-semibold) was 2px under spec, and this would
      // have silently propagated to all 12 remaining pages if not fixed here. Values mirror globals.css's
      // --text-* custom-property block 1:1 (kept there too, for any plain-CSS/CSS-Module context that
      // isn't reachable by a Tailwind utility class). Tailwind's [size, {lineHeight, letterSpacing,
      // fontWeight}] tuple format supports a raw clamp() string directly in the size slot, so text-2xl/
      // text-3xl's fluid sizes are expressed here too — no "can't express clamp() cleanly" limitation.
      // letterSpacing -0.01em only at >= text-xl, per §3.2 ("no positive tracking on Thai; 0 below xl").
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.5', fontWeight: '500' }],
        sm: ['0.875rem', { lineHeight: '1.55', fontWeight: '400' }],
        base: ['1rem', { lineHeight: '1.6', fontWeight: '400' }],
        lg: ['1.125rem', { lineHeight: '1.5', fontWeight: '500' }],
        xl: ['1.375rem', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '-0.01em' }],
        '2xl': ['clamp(1.625rem, 1.4rem + 1.1vw, 2rem)', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '-0.01em' }],
        '3xl': ['clamp(2rem, 1.6rem + 2vw, 2.75rem)', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.01em' }]
      },

      // ── §3.2 Typography — family. var(--font-sans)/var(--font-numeric) resolve to next/font's
      // self-hosted family inside the app shell (set on pages/_app.js's root wrapper); the literal
      // names after it are the same fallback chain globals.css's :root token block defines, for any
      // element outside that scope. ──
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'Anuphan',
          'IBM Plex Sans Thai',
          'Noto Sans Thai',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif'
        ],
        numeric: [
          'var(--font-numeric)',
          'IBM Plex Mono',
          'ui-monospace',
          'SF Mono',
          'Menlo',
          'monospace'
        ]
      },

      // ── §3.3 Spacing — 4px base, 8 deliberately non-linear steps. Named `space-N` (not the bare
      // numeral) so these never silently collide with Tailwind's own default numeric spacing scale
      // (whose steps diverge from step 5 onward — default 5=20px vs this system's space-5=24px). This
      // keeps `p-4`/`gap-2`/etc. meaning what Tailwind normally means while making the token scale
      // reachable, unambiguous and grep-able as `p-space-4`, `gap-space-2`, etc. ──
      spacing: {
        'space-1': '4px',
        'space-2': '8px',
        'space-3': '12px',
        'space-4': '16px',
        'space-5': '24px',
        'space-6': '32px',
        'space-7': '48px',
        'space-8': '64px'
      },

      // ── §3.4 Radius — xs/sm/md/lg/full only. Overrides Tailwind's stock sm/md/lg/full so the
      // standard `rounded-*` vocabulary resolves to this system instead of Tailwind's defaults. `xl`/
      // `2xl`/`3xl` are deliberately left undeclared here rather than overridden — UX_SPEC §3.4 states
      // "24px is retired" (Tailwind's stock `rounded-3xl` = 24px), so those keys should not be used on
      // any redesigned surface; this is a per-page code-review check (mirrors AC-14/AC-15's own manual
      // grep pattern), not a value this config silently redefines to something else.
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        full: '9999px'
      },

      // ── §3.5 Elevation — depth is primarily the surface step; shadow is secondary and always
      // neutral black, never a coloured glow (ADR-019 rule 3 — "structure only", enforced here by not
      // letting the shadow itself express a token change across breakpoints). ──
      boxShadow: {
        'elev-0': 'none',
        'elev-1': '0 1px 2px rgba(0,0,0,0.40)',
        'elev-2': '0 4px 12px rgba(0,0,0,0.45)',
        'elev-3': '0 16px 40px rgba(0,0,0,0.55)'
      },

      // ── §3.6 Motion — ease-out-quart, no overshoot/bounce (ADR-006 Decision 2, carried forward). ──
      transitionTimingFunction: {
        graphite: 'cubic-bezier(0.22, 1, 0.36, 1)'
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '280ms'
      }
    }
  },
  plugins: []
};
