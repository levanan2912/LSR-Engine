import React, { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme'
import AuthPage from './pages/AuthPage'
import Dashboard from './pages/Dashboard'
import HistoryPage from './pages/HistoryPage'
import ForumPage from './pages/ForumPage'
import ChangePasswordModal from './components/ChangePasswordModal'

type Page = 'dashboard' | 'history' | 'forum'

export default function App() {
  const { user, loading, login, register, logout, authFetch, updateUser } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [page, setPage] = useState<Page>('dashboard')

  const isDark = theme === 'dark'

  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '16px',
      background: isDark
        ? 'linear-gradient(135deg, #020617 0%, #0f0a2e 40%, #0c1a3a 70%, #060e1a 100%)'
        : 'linear-gradient(135deg, #f1f5f9 0%, #e8edf5 40%, #dde5f0 70%, #edf2f8 100%)',
    }}>
      <div style={{ fontSize: '36px', filter: 'drop-shadow(0 0 12px rgba(99,102,241,0.6))' }}>📡</div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {[0, 0.2, 0.4].map((d, i) => (
          <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #a855f7)', animation: `pulse 1.4s ease-in-out ${d}s infinite` }} />
        ))}
      </div>
      <span style={{ fontSize: '13px', color: '#6366f1', fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '0.5px' }}>LSR Engine đang khởi động...</span>
      <style>{`@keyframes pulse{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}`}</style>
    </div>
  )

  if (!user) return <AuthPage onLogin={login} onRegister={register} theme={theme} onToggleTheme={toggleTheme} />

  // Force password change if admin reset the password
  if (user.must_change_password) {
    const tempPw = sessionStorage.getItem('lsr_temp_pw') || ''
    return (
      <div style={{
        minHeight: '100vh',
        background: isDark
          ? 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #0d1117 100%)'
          : 'linear-gradient(135deg, #f1f5f9 0%, #e8edf5 50%, #edf2f8 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <ChangePasswordModal
          authFetch={authFetch}
          onClose={() => {
            sessionStorage.removeItem('lsr_temp_pw')
            window.location.reload()
          }}
          onSuccess={(newToken, newUser) => {
            updateUser(newUser, newToken)
          }}
          theme={theme}
          forceMode={true}
          tempPassword={tempPw}
        />
      </div>
    )
  }

  const shared = {
    user, authFetch, onLogout: logout,
    onNavigate: setPage, currentPage: page,
    theme, onToggleTheme: toggleTheme,
  }

  if (page === 'forum')   return <ForumPage   {...shared} />
  if (page === 'history') return <HistoryPage {...shared} />
  return <Dashboard {...shared} />
}
