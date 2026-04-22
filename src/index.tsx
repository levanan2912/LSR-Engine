import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { ADMIN_HTML } from './server/admin-html'
import authRoutes from './server/routes/auth'
import entriesRoutes from './server/routes/entries'
import reportsRoutes from './server/routes/reports'
import geminiRoutes from './server/routes/gemini'
import adminRoutes from './server/routes/admin'
import chatRoutes from './server/routes/chat'

type Bindings = {
  DB: D1Database
  GEMINI_API_KEY: string
  GEMINI_API_KEYS: string
  JWT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/entries', entriesRoutes)
app.route('/api/reports', reportsRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/chat', chatRoutes)
app.route('/api', geminiRoutes)

// Serve static assets
app.use('/static/*', serveStatic({ root: './' }))

// Admin Console – serve embedded HTML directly, bypassing CF Pages static cache
app.get('/admin', (c) => new Response(ADMIN_HTML, {
  headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store, must-revalidate' }
}))
app.get('/admin/', (c) => new Response(ADMIN_HTML, {
  headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store, must-revalidate' }
}))

// SPA fallback - serve index.html for all other routes
app.get('*', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="vi" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LSR Engine – Learning Stability Risk Engine</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <!-- Anti-FOUC: apply saved theme before paint -->
  <script>
    (function(){
      try {
        var t = localStorage.getItem('lsr_theme') || 'dark';
        var dark = {
          '--bg-page':'#020617','--bg-page-2':'#0f172a',
          '--bg-card':'rgba(255,255,255,0.03)','--bg-card-solid':'#0f172a','--bg-card-strong':'rgba(255,255,255,0.05)',
          '--bg-input':'#0a0a0a','--bg-nav':'rgba(2,6,23,0.92)',
          '--bg-row':'rgba(255,255,255,0.02)','--bg-row-hover':'rgba(255,255,255,0.04)','--bg-row-open':'rgba(255,255,255,0.04)','--bg-expanded':'rgba(0,0,0,0.25)',
          '--border':'rgba(255,255,255,0.07)','--border-input':'#1e293b','--border-card':'rgba(255,255,255,0.07)','--border-row':'rgba(255,255,255,0.06)',
          '--text-primary':'#e2e8f0','--text-secondary':'#94a3b8','--text-muted':'#94a3b8',
          '--text-faint':'#64748b','--text-placeholder':'#64748b','--text-label':'#94a3b8',
          '--nav-inactive':'#94a3b8','--nav-email':'#94a3b8','--nav-logout':'#94a3b8',
          '--stats-label':'#94a3b8','--stats-sub':'#94a3b8','--section-title':'#94a3b8','--section-border':'rgba(255,255,255,0.06)',
          '--trend-legend':'#94a3b8','--trend-title':'#94a3b8','--session-time':'#94a3b8',
          '--meta-label':'#94a3b8','--meta-value':'#e2e8f0','--chip-label':'#94a3b8',
          '--body-bg':'linear-gradient(135deg,#020617 0%,#0f0a2e 40%,#0c1a3a 70%,#060e1a 100%)',
          '--body-color':'#f1f5f9','--card-shadow':'0 2px 12px rgba(0,0,0,0.4)','--stats-divider':'rgba(255,255,255,0.06)'
        };
        var light = {
          '--bg-page':'#dce3ef','--bg-page-2':'#c9d3e4',
          '--bg-card':'#ffffff','--bg-card-solid':'#ffffff','--bg-card-strong':'#f4f7fb',
          '--bg-input':'#f8fafc','--bg-nav':'rgba(255,255,255,0.98)',
          '--bg-row':'#ffffff','--bg-row-hover':'#f0f4fa','--bg-row-open':'#edf2ff','--bg-expanded':'#f4f7fb',
          '--border':'#b8c5d8','--border-input':'#b8c5d8','--border-card':'#d0daea','--border-row':'#d8e1ed',
          '--text-primary':'#0f172a','--text-secondary':'#1e293b','--text-muted':'#334155',
          '--text-faint':'#475569','--text-placeholder':'#94a3b8','--text-label':'#1e293b',
          '--nav-inactive':'#334155','--nav-email':'#475569','--nav-logout':'#334155',
          '--stats-label':'#1e293b','--stats-sub':'#475569','--section-title':'#1e293b','--section-border':'#d0daea',
          '--trend-legend':'#475569','--trend-title':'#1e293b','--session-time':'#475569',
          '--meta-label':'#475569','--meta-value':'#0f172a','--chip-label':'#334155',
          '--body-bg':'linear-gradient(160deg,#dce3ef 0%,#c9d3e4 50%,#d1dae8 100%)',
          '--body-color':'#0f172a','--card-shadow':'0 1px 3px rgba(15,23,42,0.07),0 4px 14px rgba(15,23,42,0.08)','--stats-divider':'#d0daea'
        };
        var v = t === 'light' ? light : dark;
        var r = document.documentElement;
        for (var k in v) r.style.setProperty(k, v[k]);
        r.setAttribute('data-theme', t);
      } catch(e){}
    })();
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { transition: background 0.25s, color 0.25s; }
    body {
      background: var(--body-bg, linear-gradient(135deg, #020617 0%, #0f0a2e 40%, #0c1a3a 70%, #060e1a 100%));
      background-attachment: fixed;
      color: var(--body-color, #f1f5f9);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      transition: background 0.25s, color 0.25s;
    }
    #root { min-height: 100vh; }
    .loader { display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 16px; }
    .loader-dot { width: 8px; height: 8px; background: #6366f1; border-radius: 50%; margin: 0 4px; animation: pulse 1.4s ease-in-out infinite; }
    .loader-dot:nth-child(2) { animation-delay: 0.2s; }
    .loader-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse { 0%, 80%, 100% { transform: scale(0); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
  </style>
</head>
<body>
  <div id="root">
    <div class="loader">
      <div class="loader-dot"></div>
      <div class="loader-dot"></div>
      <div class="loader-dot"></div>
    </div>
  </div>
  <script type="module" src="/static/client.js"></script>
</body>
</html>`)
})

export default app
