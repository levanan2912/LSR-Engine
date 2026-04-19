import { useState, useEffect, useCallback } from 'react'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'lsr_theme'

// ── CSS variable sets ────────────────────────────────────────────────────────
export const THEME_VARS: Record<Theme, Record<string, string>> = {
  // ── DARK ─────────────────────────────────────────────────────────────────
  dark: {
    '--bg-page':            '#020617',
    '--bg-page-2':          '#0f172a',
    '--bg-card':            'rgba(255,255,255,0.03)',
    '--bg-card-solid':      '#0f172a',
    '--bg-card-strong':     'rgba(255,255,255,0.05)',
    '--bg-input':           '#0a0a0a',
    '--bg-nav':             'rgba(2,6,23,0.92)',
    '--bg-row':             'rgba(255,255,255,0.02)',
    '--bg-row-hover':       'rgba(255,255,255,0.04)',
    '--bg-row-open':        'rgba(255,255,255,0.04)',
    '--bg-expanded':        'rgba(0,0,0,0.25)',
    '--border':             'rgba(255,255,255,0.07)',
    '--border-input':       '#1e293b',
    '--border-card':        'rgba(255,255,255,0.07)',
    '--border-row':         'rgba(255,255,255,0.06)',
    '--text-primary':       '#e2e8f0',
    '--text-secondary':     '#94a3b8',
    '--text-muted':         '#94a3b8',
    '--text-faint':         '#64748b',
    '--text-placeholder':   '#64748b',
    '--text-label':         '#94a3b8',
    '--nav-inactive':       '#94a3b8',
    '--nav-email':          '#94a3b8',
    '--nav-logout':         '#94a3b8',
    '--stats-label':        '#94a3b8',
    '--stats-sub':          '#94a3b8',
    '--section-title':      '#94a3b8',
    '--section-border':     'rgba(255,255,255,0.06)',
    '--trend-legend':       '#94a3b8',
    '--trend-title':        '#94a3b8',
    '--session-time':       '#94a3b8',
    '--meta-label':         '#94a3b8',
    '--meta-value':         '#e2e8f0',
    '--chip-label':         '#94a3b8',
    '--body-bg':            'linear-gradient(135deg,#020617 0%,#0f0a2e 40%,#0c1a3a 70%,#060e1a 100%)',
    '--body-color':         '#f1f5f9',
    '--card-shadow':        '0 2px 12px rgba(0,0,0,0.4)',
    '--stats-divider':      'rgba(255,255,255,0.06)',
  },

  // ── LIGHT ────────────────────────────────────────────────────────────────
  // Design philosophy: cool slate-blue page (#dce3ef), clean white cards with
  // real drop-shadows, navy text (#0f172a) for primary, all WCAG AA or better.
  // Every color is chosen for clarity against a white/near-white card surface.
  light: {
    '--bg-page':            '#dce3ef',
    '--bg-page-2':          '#c9d3e4',
    '--bg-card':            '#ffffff',
    '--bg-card-solid':      '#ffffff',
    '--bg-card-strong':     '#f4f7fb',
    '--bg-input':           '#f8fafc',
    '--bg-nav':             'rgba(255,255,255,0.98)',
    '--bg-row':             '#ffffff',
    '--bg-row-hover':       '#f0f4fa',
    '--bg-row-open':        '#edf2ff',
    '--bg-expanded':        '#f4f7fb',
    '--border':             '#b8c5d8',
    '--border-input':       '#b8c5d8',
    '--border-card':        '#d0daea',
    '--border-row':         '#d8e1ed',
    '--text-primary':       '#0f172a',
    '--text-secondary':     '#1e293b',
    '--text-muted':         '#334155',
    '--text-faint':         '#475569',
    '--text-placeholder':   '#94a3b8',
    '--text-label':         '#1e293b',
    '--nav-inactive':       '#334155',
    '--nav-email':          '#475569',
    '--nav-logout':         '#334155',
    '--stats-label':        '#1e293b',
    '--stats-sub':          '#475569',
    '--section-title':      '#1e293b',
    '--section-border':     '#d0daea',
    '--trend-legend':       '#475569',
    '--trend-title':        '#1e293b',
    '--session-time':       '#475569',
    '--meta-label':         '#475569',
    '--meta-value':         '#0f172a',
    '--chip-label':         '#334155',
    '--body-bg':            'linear-gradient(160deg,#dce3ef 0%,#c9d3e4 50%,#d1dae8 100%)',
    '--body-color':         '#0f172a',
    '--card-shadow':        '0 1px 3px rgba(15,23,42,0.07), 0 4px 14px rgba(15,23,42,0.08)',
    '--stats-divider':      '#d0daea',
  },
}

// ── Inject one-time transition style for smooth theme switching ──────────────
let _transitionInjected = false
function injectThemeTransition() {
  if (_transitionInjected || typeof document === 'undefined') return
  _transitionInjected = true
  const style = document.createElement('style')
  style.id = 'theme-transition'
  style.textContent = `
    html.theme-transitioning,
    html.theme-transitioning *,
    html.theme-transitioning *::before,
    html.theme-transitioning *::after {
      transition:
        background-color 0.35s ease,
        background 0.35s ease,
        border-color 0.35s ease,
        color 0.35s ease,
        box-shadow 0.35s ease !important;
    }
  `
  document.head.appendChild(style)
}

// ── Apply variables to document root ────────────────────────────────────────
export function applyTheme(theme: Theme, animate = false) {
  injectThemeTransition()
  const root = document.documentElement
  if (animate) {
    root.classList.add('theme-transitioning')
    // Remove class after transition completes so it doesn't slow down other animations
    setTimeout(() => root.classList.remove('theme-transitioning'), 400)
  }
  const vars = THEME_VARS[theme]
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
  root.setAttribute('data-theme', theme)
}

// ── Inline script string (run before React for FOUC prevention) ─────────────
export const ANTI_FOUC_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem('lsr_theme') || 'dark';
    var vars = ${JSON.stringify(THEME_VARS)};
    var v = vars[t] || vars['dark'];
    Object.entries(v).forEach(function(e){ document.documentElement.style.setProperty(e[0], e[1]); });
    document.documentElement.setAttribute('data-theme', t);
  } catch(e){}
})();
`

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    try { return (localStorage.getItem(THEME_KEY) as Theme) || 'dark' } catch { return 'dark' }
  })

  useEffect(() => { applyTheme(theme) }, [theme])

  const setTheme = useCallback((t: Theme, animate = false) => {
    setThemeState(t)
    try { localStorage.setItem(THEME_KEY, t) } catch {}
    applyTheme(t, animate)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark', true)
  }, [theme, setTheme])

  return { theme, setTheme, toggleTheme }
}
