import React, { useState, useEffect, useCallback, useRef } from 'react'
import { User, ForumPost, ForumComment, ForumTag } from '../types'
import ChatBot from '../components/ChatBot'
import ChangePasswordModal from '../components/ChangePasswordModal'

interface Props {
  user: User
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  onLogout: () => void
  onNavigate: (page: 'dashboard' | 'history' | 'forum') => void
  currentPage: string
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
}

type SortMode = 'newest' | 'top'

interface CommentNode extends ForumComment {
  children: CommentNode[]
}

const NAV = [
  { id: 'dashboard', label: '🏠 Bảng điều khiển' },
  { id: 'history',   label: '📈 Lịch sử' },
  { id: 'forum',     label: '💬 Diễn đàn' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'vừa xong'
  if (mins < 60)  return `${mins} phút trước`
  if (hours < 24) return `${hours} giờ trước`
  if (days < 30)  return `${days} ngày trước`
  return new Date(dateStr).toLocaleDateString('vi-VN')
}

function authorLabel(name: string, email: string): string {
  return name && name.trim() ? name : email.split('@')[0]
}

function buildTree(flat: ForumComment[]): CommentNode[] {
  const map = new Map<number, CommentNode>()
  const roots: CommentNode[] = []
  for (const c of flat) map.set(c.id, { ...c, children: [] })
  for (const node of map.values()) {
    if (node.parent_id != null && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// ─── TagBadge ─────────────────────────────────────────────────────────────────

function TagBadge({ tag, small = false, onClick }: {
  tag: ForumTag
  small?: boolean
  onClick?: () => void
}) {
  const pad    = small ? '2px 7px' : '3px 10px'
  const fSize  = small ? '10px' : '11px'
  return (
    <span
      onClick={e => { if (onClick) { e.stopPropagation(); onClick() } }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        background: `${tag.color}22`,
        border: `1px solid ${tag.color}55`,
        borderRadius: '20px', padding: pad,
        fontSize: fSize, fontWeight: 600,
        color: tag.color,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none', whiteSpace: 'nowrap',
        transition: 'all 0.12s',
        lineHeight: 1.4,
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = `${tag.color}40` }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = `${tag.color}22` }}
    >
      {tag.icon} {tag.label}
    </span>
  )
}

// ─── TagSelector ──────────────────────────────────────────────────────────────
// Used inside CreatePostModal — shows all available tags as clickable chips

function TagSelector({ tags, selected, onChange, isDark }: {
  tags: ForumTag[]
  selected: number[]
  onChange: (ids: number[]) => void
  isDark: boolean
}) {
  const toggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter(x => x !== id))
    } else if (selected.length < 5) {
      onChange([...selected, id])
    }
  }

  return (
    <div>
      <label style={{
        fontSize: '12px', color: isDark ? '#94a3b8' : '#64748b',
        fontWeight: 600, display: 'block', marginBottom: '8px',
      }}>
        Thể loại <span style={{ fontWeight: 400, color: isDark ? '#64748b' : '#94a3b8' }}>(chọn 1–5)</span>
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {tags.map(tag => {
          const active = selected.includes(tag.id)
          return (
            <span
              key={tag.id}
              onClick={() => toggle(tag.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                background: active ? `${tag.color}30` : (isDark ? 'rgba(255,255,255,0.05)' : '#f1f5f9'),
                border: `1.5px solid ${active ? tag.color : (isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0')}`,
                borderRadius: '20px', padding: '4px 12px',
                fontSize: '12px', fontWeight: active ? 700 : 500,
                color: active ? tag.color : (isDark ? '#94a3b8' : '#64748b'),
                cursor: 'pointer', userSelect: 'none',
                transition: 'all 0.12s',
                boxShadow: active ? `0 0 0 2px ${tag.color}33` : 'none',
              }}
            >
              {tag.icon} {tag.label}
              {active && <span style={{ fontSize: '9px', marginLeft: '1px' }}>✓</span>}
            </span>
          )
        })}
      </div>
      {selected.length === 5 && (
        <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '5px' }}>
          ⚠️ Tối đa 5 thể loại
        </div>
      )}
    </div>
  )
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const colors = ['#6366f1','#8b5cf6','#ec4899','#0ea5e9','#10b981','#f59e0b','#ef4444']
  const idx = (name.charCodeAt(0) || 0) % colors.length
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: colors[idx],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: Math.max(10, size * 0.38),
      flexShrink: 0, fontFamily: 'Space Grotesk, sans-serif', userSelect: 'none',
    }}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

// ─── ReplyBox ─────────────────────────────────────────────────────────────────

function ReplyBox({ isDark, parentAuthor, onSubmit, onCancel }: {
  isDark: boolean
  parentAuthor: string
  onSubmit: (text: string) => Promise<void>
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    await onSubmit(text.trim())
    setBusy(false)
  }

  return (
    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <textarea
        ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
        placeholder={`Trả lời ${parentAuthor}… (Enter để gửi, Shift+Enter xuống dòng)`}
        rows={2}
        style={{
          width: '100%', resize: 'none',
          background: isDark ? 'rgba(0,0,0,0.25)' : '#f0f4ff',
          border: `1px solid ${isDark ? 'rgba(99,102,241,0.4)' : '#818cf8'}`,
          borderRadius: '8px', padding: '8px 10px',
          color: isDark ? '#e2e8f0' : '#0f172a',
          fontSize: '13px', fontFamily: 'Inter, sans-serif', lineHeight: 1.5, outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{
          background: 'transparent',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#e2e8f0'}`,
          borderRadius: '6px', padding: '4px 12px',
          color: isDark ? '#94a3b8' : '#64748b', fontSize: '12px', cursor: 'pointer',
        }}>Hủy</button>
        <button onClick={submit} disabled={busy || !text.trim()} style={{
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          border: 'none', borderRadius: '6px', padding: '4px 14px',
          color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          opacity: (busy || !text.trim()) ? 0.5 : 1,
        }}>
          {busy ? '…' : '↩ Gửi'}
        </button>
      </div>
    </div>
  )
}

// ─── CommentItem (recursive — unlimited depth) ────────────────────────────────

function CommentItem({ node, userId, isDark, depth, onReply, onDelete }: {
  node: CommentNode
  userId: number
  isDark: boolean
  depth: number
  onReply: (parentId: number, parentAuthor: string, text: string) => Promise<void>
  onDelete: (id: number) => void
}) {
  const [childrenOpen, setChildrenOpen] = useState(depth < 2)
  const [showReplyBox, setShowReplyBox] = useState(false)

  const label      = authorLabel(node.author_name, node.author_email)
  const isMine     = node.user_id === userId
  const hasChildren = node.children.length > 0
  const indentPx   = Math.min(depth * 20, 120)
  const avatarSz   = Math.max(20, 28 - depth * 2)
  const lineColors = ['#818cf8','#a78bfa','#c4b5fd','#ddd6fe','#ede9fe']
  const lineColor  = lineColors[Math.min(depth, lineColors.length - 1)]
  const bg     = depth === 0 ? (isDark ? 'rgba(255,255,255,0.04)' : '#ffffff') : (isDark ? 'rgba(255,255,255,0.025)' : '#f8fafc')
  const border = depth === 0 ? (isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0') : (isDark ? 'rgba(255,255,255,0.06)' : '#e8edf4')

  return (
    <div style={{ marginLeft: `${indentPx}px` }}>
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: '10px', padding: '10px 13px', display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
        <Avatar name={label} size={avatarSz} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: isDark ? '#94a3b8' : '#475569' }}>
              {label}
              <span style={{ fontWeight: 400, marginLeft: '5px', color: isDark ? '#64748b' : '#94a3b8', fontSize: '11px' }}>
                · {timeAgo(node.created_at)}
              </span>
            </span>
            {isMine && (
              <button
                onClick={() => onDelete(node.id)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#64748b' : '#94a3b8', fontSize: '11px', padding: '1px 3px', borderRadius: '4px', lineHeight: 1, transition: 'color 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = isDark ? '#64748b' : '#94a3b8' }}
                title="Xóa"
              >🗑</button>
            )}
          </div>
          <div style={{ fontSize: '13px', color: isDark ? '#cbd5e1' : '#334155', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
            {node.content}
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '7px', alignItems: 'center' }}>
            <button
              onClick={() => { setShowReplyBox(v => !v); if (!showReplyBox && !childrenOpen) setChildrenOpen(true) }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontSize: '12px', fontWeight: 600, color: showReplyBox ? '#818cf8' : (isDark ? '#64748b' : '#94a3b8'), display: 'flex', alignItems: 'center', gap: '3px' }}
            >↩ Trả lời</button>
            {hasChildren && (
              <button
                onClick={() => setChildrenOpen(v => !v)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontSize: '12px', fontWeight: 600, color: childrenOpen ? '#818cf8' : (isDark ? '#64748b' : '#94a3b8'), display: 'flex', alignItems: 'center', gap: '4px', transition: 'color 0.15s' }}
              >
                <span style={{ display: 'inline-block', fontSize: '9px', transform: childrenOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▶</span>
                {node.children.length} phản hồi
              </button>
            )}
          </div>
          {showReplyBox && (
            <ReplyBox
              isDark={isDark} parentAuthor={label}
              onSubmit={async (text) => { await onReply(node.id, label, text); setShowReplyBox(false); setChildrenOpen(true) }}
              onCancel={() => setShowReplyBox(false)}
            />
          )}
        </div>
      </div>
      {hasChildren && childrenOpen && (
        <div style={{ marginTop: '6px', borderLeft: `2px solid ${lineColor}`, paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {node.children.map(child => (
            <CommentItem key={child.id} node={child} userId={userId} isDark={isDark} depth={depth + 1} onReply={onReply} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── PostCard ─────────────────────────────────────────────────────────────────

function PostCard({ post, userId, isDark, onClick, onDelete, onTagClick }: {
  post: ForumPost; userId: number; isDark: boolean
  onClick: () => void; onDelete: (id: number) => void
  onTagClick: (slug: string) => void
}) {
  const label   = authorLabel(post.author_name, post.author_email)
  const isOwner = post.user_id === userId
  const preview = post.content.length > 180 ? post.content.slice(0, 180) + '…' : post.content

  return (
    <div
      onClick={onClick}
      style={{
        background: isDark ? 'rgba(255,255,255,0.04)' : '#ffffff',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`,
        borderRadius: '12px', padding: '16px 18px', cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = isDark ? 'rgba(99,102,241,0.4)' : '#818cf8'
        el.style.background  = isDark ? 'rgba(99,102,241,0.07)' : '#f5f3ff'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'
        el.style.background  = isDark ? 'rgba(255,255,255,0.04)' : '#ffffff'
      }}
    >
      {/* Pending banner — only visible to owner */}
      {isOwner && (post as any).status === 'pending' && (
        <div style={{
          background: 'rgba(245,158,11,0.12)',
          border: '1px solid rgba(245,158,11,0.35)',
          borderRadius: '8px', padding: '7px 12px',
          fontSize: '12px', color: '#f59e0b',
          display: 'flex', alignItems: 'center', gap: '7px',
          lineHeight: 1.5,
        }}>
          <span>⏳</span>
          <span>
            <strong>Đang chờ duyệt</strong> — Bài viết của bạn đang được admin xem xét. 
            {(post as any).ai_moderation_reason && (
              <span style={{ color: '#fbbf24' }}> AI nhận xét: {(post as any).ai_moderation_reason}</span>
            )}
          </span>
        </div>
      )}

      {/* Author row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <Avatar name={label} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a', marginBottom: '2px', lineHeight: 1.3 }}>
            {post.title}
            {(post as any).status === 'pending' && (
              <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', padding: '1px 7px', verticalAlign: 'middle' }}>⏳ Chờ duyệt</span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: isDark ? '#64748b' : '#94a3b8' }}>
            <span style={{ color: isDark ? '#94a3b8' : '#475569', fontWeight: 500 }}>{label}</span>
            {' · '}{timeAgo(post.created_at)}
          </div>
        </div>
        {isOwner && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(post.id) }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#64748b' : '#94a3b8', fontSize: '13px', padding: '2px 6px', borderRadius: '6px', flexShrink: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = isDark ? '#64748b' : '#94a3b8' }}
            title="Xóa bài"
          >🗑</button>
        )}
      </div>

      {/* Tags */}
      {post.tags && post.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {post.tags.map(tag => (
            <TagBadge key={tag.id} tag={tag} small onClick={() => onTagClick(tag.slug)} />
          ))}
        </div>
      )}

      {/* Preview */}
      <div style={{ fontSize: '13px', color: isDark ? '#94a3b8' : '#475569', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
        {preview}
      </div>

      {/* Counters */}
      <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: isDark ? '#64748b' : '#94a3b8' }}>
        <span>❤️ {post.like_count}</span>
        <span>💬 {post.comment_count} bình luận</span>
      </div>
    </div>
  )
}

// ─── PostDetail ───────────────────────────────────────────────────────────────

function PostDetail({ postId, userId, isDark, authFetch, onBack, onTagClick }: {
  postId: number; userId: number; isDark: boolean
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  onBack: () => void
  onTagClick: (slug: string) => void
}) {
  const [post, setPost]         = useState<ForumPost | null>(null)
  const [comments, setComments] = useState<ForumComment[]>([])
  const [liked, setLiked]       = useState(false)
  const [loading, setLoading]   = useState(true)
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [likeCount, setLikeCount]     = useState(0)
  const [error, setError]       = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadPost = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await authFetch(`/api/forum/posts/${postId}`)
      const data = await res.json() as any
      if (res.ok) {
        setPost(data.post)
        setComments(data.comments)
        setLiked(data.liked)
        setLikeCount(data.post.like_count)
      } else setError('Không thể tải bài viết.')
    } catch { setError('Lỗi kết nối.') }
    finally  { setLoading(false) }
  }, [postId, authFetch])

  useEffect(() => { loadPost() }, [loadPost])

  const handleLike = async () => {
    try {
      const res  = await authFetch(`/api/forum/posts/${postId}/like`, { method: 'POST' })
      const data = await res.json() as any
      if (res.ok) { setLiked(data.liked); setLikeCount(data.like_count) }
    } catch {}
  }

  const handleComment = async () => {
    if (!commentText.trim()) return
    setSubmitting(true)
    try {
      const res  = await authFetch(`/api/forum/posts/${postId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentText.trim() }),
      })
      const data = await res.json() as any
      if (res.ok) { setComments(prev => [...prev, data.comment]); setCommentText('') }
      else alert(data.message || 'Lỗi khi gửi bình luận')
    } catch { alert('Lỗi kết nối') }
    setSubmitting(false)
  }

  const handleReply = async (parentId: number, _parentAuthor: string, text: string) => {
    try {
      const res  = await authFetch(`/api/forum/posts/${postId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, parent_id: parentId }),
      })
      const data = await res.json() as any
      if (res.ok) setComments(prev => [...prev, data.comment])
      else alert(data.message || 'Lỗi khi gửi trả lời')
    } catch { alert('Lỗi kết nối') }
  }

  const handleDeleteComment = async (id: number) => {
    if (!confirm('Xóa bình luận này?')) return
    try {
      const res = await authFetch(`/api/forum/comments/${id}`, { method: 'DELETE' })
      if (res.ok) {
        const toRemove = new Set<number>([id])
        let prev = -1
        while (prev !== toRemove.size) {
          prev = toRemove.size
          comments.forEach(c => { if (c.parent_id != null && toRemove.has(c.parent_id)) toRemove.add(c.id) })
        }
        setComments(prev => prev.filter(c => !toRemove.has(c.id)))
      }
    } catch {}
  }

  const tree = buildTree(comments)
  const card: React.CSSProperties = {
    background: isDark ? 'rgba(255,255,255,0.04)' : '#ffffff',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`,
    borderRadius: '12px',
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: isDark ? '#64748b' : '#94a3b8' }}>Đang tải…</div>
  if (error || !post) return <div style={{ textAlign: 'center', padding: '60px', color: '#ef4444' }}>{error || 'Không tìm thấy bài viết.'}</div>

  const label = authorLabel(post.author_name, post.author_email)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Back */}
      <button onClick={onBack} style={{
        alignSelf: 'flex-start', background: 'transparent', border: 'none',
        color: isDark ? '#818cf8' : '#6366f1', fontSize: '13px', fontWeight: 600,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', padding: 0,
        fontFamily: 'Space Grotesk, sans-serif',
      }}>← Quay lại diễn đàn</button>

      {/* Post body */}
      <div style={{ ...card, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Pending notice in detail view */}
        {(post as any).status === 'pending' && (
          <div style={{
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: '8px', padding: '10px 14px',
            fontSize: '13px', color: '#f59e0b',
            display: 'flex', alignItems: 'flex-start', gap: '8px', lineHeight: 1.55,
          }}>
            <span style={{ fontSize: '16px' }}>⏳</span>
            <div>
              <strong>Bài viết đang chờ duyệt</strong>
              <div style={{ fontSize: '12px', marginTop: '2px', color: '#fbbf24' }}>
                Nội dung của bạn đang được admin xem xét trước khi hiển thị công khai.
                {(post as any).ai_moderation_reason && (
                  <span> AI nhận xét: <em>{(post as any).ai_moderation_reason}</em></span>
                )}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <Avatar name={label} size={38} />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a', lineHeight: 1.3, marginBottom: '4px' }}>
              {post.title}
              {(post as any).status === 'pending' && (
                <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', padding: '2px 8px', verticalAlign: 'middle' }}>⏳ Chờ duyệt</span>
              )}
            </h2>
            <div style={{ fontSize: '12px', color: isDark ? '#64748b' : '#94a3b8' }}>
              <span style={{ fontWeight: 500, color: isDark ? '#94a3b8' : '#475569' }}>{label}</span>
              {' · '}{timeAgo(post.created_at)}
              {post.updated_at !== post.created_at && <span style={{ marginLeft: '6px', fontStyle: 'italic' }}>(đã chỉnh sửa)</span>}
            </div>
          </div>
        </div>

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {post.tags.map(tag => (
              <TagBadge key={tag.id} tag={tag} onClick={() => { onBack(); onTagClick(tag.slug) }} />
            ))}
          </div>
        )}

        <div style={{ fontSize: '14px', color: isDark ? '#cbd5e1' : '#334155', lineHeight: 1.75, whiteSpace: 'pre-line', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9'}`, paddingTop: '14px' }}>
          {post.content}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={handleLike} style={{
            background: liked ? (isDark ? 'rgba(239,68,68,0.15)' : '#fff1f2') : (isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc'),
            border: `1px solid ${liked ? '#ef4444' : (isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0')}`,
            borderRadius: '20px', padding: '5px 14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '13px', fontWeight: 600, transition: 'all 0.15s',
            color: liked ? '#ef4444' : (isDark ? '#94a3b8' : '#64748b'),
          }}>
            {liked ? '❤️' : '🤍'} {likeCount}
          </button>
          <span style={{ fontSize: '12px', color: isDark ? '#64748b' : '#94a3b8' }}>💬 {comments.length} bình luận</span>
        </div>
      </div>

      {/* Comments */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          Bình luận ({comments.length})
        </h3>

        {tree.map(node => (
          <CommentItem key={node.id} node={node} userId={userId} isDark={isDark} depth={0} onReply={handleReply} onDelete={handleDeleteComment} />
        ))}

        {tree.length === 0 && (
          <div style={{ textAlign: 'center', padding: '28px', background: isDark ? 'rgba(255,255,255,0.02)' : '#fafafa', border: `1px dashed ${isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`, borderRadius: '10px', color: isDark ? '#64748b' : '#94a3b8', fontSize: '13px' }}>
            Chưa có bình luận. Hãy là người đầu tiên!
          </div>
        )}

        {/* New top-level comment */}
        <div style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
          <textarea
            ref={textareaRef}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment() } }}
            placeholder="Viết bình luận… (Enter để gửi, Shift+Enter xuống dòng)"
            rows={3}
            style={{
              width: '100%', resize: 'vertical',
              background: isDark ? 'rgba(0,0,0,0.2)' : '#f8fafc',
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0'}`,
              borderRadius: '8px', padding: '10px 12px',
              color: isDark ? '#e2e8f0' : '#0f172a',
              fontSize: '13px', fontFamily: 'Inter, sans-serif', lineHeight: 1.5, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleComment} disabled={submitting || !commentText.trim()} style={{
              background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              border: 'none', borderRadius: '8px', padding: '7px 18px',
              color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              opacity: (submitting || !commentText.trim()) ? 0.5 : 1,
            }}>
              {submitting ? 'Đang gửi…' : '✉️ Gửi bình luận'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── CreatePostModal ──────────────────────────────────────────────────────────

function CreatePostModal({ isDark, authFetch, onClose, onCreated }: {
  isDark: boolean
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  onClose: () => void
  onCreated: (post: ForumPost, isPending: boolean) => void
}) {
  const [title, setTitle]       = useState('')
  const [content, setContent]   = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [allTags, setAllTags]   = useState<ForumTag[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [aiLoading, setAiLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [aiErr, setAiErr]       = useState('')

  // Load tags once
  useEffect(() => {
    authFetch('/api/forum/tags')
      .then(r => r.json())
      .then((d: any) => { if (d.tags) setAllTags(d.tags) })
      .catch(() => {})
  }, [authFetch])

  const handleAIDraft = async () => {
    setAiErr('')
    setAiLoading(true)
    try {
      const res  = await authFetch('/api/forum/ai-draft', { method: 'POST' })
      const data = await res.json() as any
      if (res.ok && data.success) {
        setTitle(data.title)
        setContent(data.content)
        // Auto-select AI-suggested tags
        if (Array.isArray(data.suggested_tag_ids) && data.suggested_tag_ids.length > 0) {
          setSelectedTagIds(data.suggested_tag_ids.slice(0, 5))
        }
        setErr('')
      } else {
        setAiErr(data.message || 'AI không thể tạo bài lúc này.')
      }
    } catch { setAiErr('Lỗi kết nối tới AI.') }
    setAiLoading(false)
  }

  const handleSubmit = async () => {
    setErr('')
    if (!title.trim())           { setErr('Vui lòng nhập tiêu đề.'); return }
    if (title.trim().length < 5) { setErr('Tiêu đề phải có ít nhất 5 ký tự.'); return }
    if (!content.trim())         { setErr('Vui lòng nhập nội dung.'); return }
    setSubmitting(true)
    try {
      const res  = await authFetch('/api/forum/posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), tag_ids: selectedTagIds }),
      })
      const data = await res.json() as any
      if (res.ok) {
        const isPending = data.moderation?.status === 'pending'
        if (isPending) {
          setErr('')
          // Show pending notice then close
          setSubmitting(false)
          onCreated(data.post, true)
          onClose()
          return
        }
        onCreated(data.post, false)
        onClose()
      } else setErr(data.message || 'Lỗi khi tạo bài.')
    } catch { setErr('Lỗi kết nối.') }
    setSubmitting(false)
  }

  const inputStyle: React.CSSProperties = {
    background: isDark ? 'rgba(0,0,0,0.3)' : '#f8fafc',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0'}`,
    borderRadius: '8px', padding: '10px 12px',
    color: isDark ? '#e2e8f0' : '#0f172a',
    fontSize: '14px', fontFamily: 'Inter, sans-serif',
    outline: 'none', width: '100%',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: isDark ? '#0f172a' : '#ffffff',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0'}`,
        borderRadius: '16px', padding: '24px',
        width: '100%', maxWidth: '600px',
        display: 'flex', flexDirection: 'column', gap: '14px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a', margin: 0 }}>
            ✍️ Tạo bài viết mới
          </h2>
          <button
            onClick={handleAIDraft} disabled={aiLoading}
            style={{
              background: aiLoading ? (isDark ? 'rgba(99,102,241,0.12)' : '#ede9fe') : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              border: `1px solid ${isDark ? 'rgba(99,102,241,0.4)' : '#818cf8'}`,
              borderRadius: '8px', padding: '7px 14px',
              color: aiLoading ? (isDark ? '#818cf8' : '#6366f1') : '#fff',
              fontSize: '12px', fontWeight: 600, cursor: aiLoading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
              transition: 'all 0.15s', flexShrink: 0, opacity: aiLoading ? 0.8 : 1,
            }}
            title="AI đọc dữ liệu học tập của bạn và viết bài thay bạn"
          >
            {aiLoading ? (
              <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: `2px solid ${isDark ? '#818cf8' : '#6366f1'}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}/>AI đang viết…</>
            ) : <>✨ Nhờ AI viết hộ</>}
          </button>
        </div>

        {/* AI callout */}
        <div style={{ background: isDark ? 'rgba(99,102,241,0.08)' : '#f0f0ff', border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : '#c7d2fe'}`, borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: isDark ? '#a5b4fc' : '#4338ca', lineHeight: 1.5 }}>
          💡 <strong>AI viết hộ:</strong> AI sẽ đọc dữ liệu học tập thực tế của bạn, rồi viết một bài thảo luận chân thực — và tự gợi ý thể loại phù hợp. Bạn có thể chỉnh sửa lại trước khi đăng.
        </div>

        {aiErr && (
          <div style={{ fontSize: '13px', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '8px 12px' }}>
            ⚠️ {aiErr}
          </div>
        )}

        {/* Title */}
        <div>
          <label style={{ fontSize: '12px', color: isDark ? '#94a3b8' : '#64748b', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Tiêu đề *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Nhập tiêu đề bài viết…" style={inputStyle} maxLength={200} />
        </div>

        {/* Content */}
        <div>
          <label style={{ fontSize: '12px', color: isDark ? '#94a3b8' : '#64748b', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Nội dung *</label>
          <textarea
            value={content} onChange={e => setContent(e.target.value)}
            placeholder="Chia sẻ kinh nghiệm, đặt câu hỏi hoặc thảo luận về việc học tập…"
            rows={7}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
            maxLength={10000}
          />
          <div style={{ fontSize: '11px', color: isDark ? '#64748b' : '#94a3b8', marginTop: '4px', textAlign: 'right' }}>{content.length}/10000</div>
        </div>

        {/* Tag selector */}
        {allTags.length > 0 && (
          <TagSelector
            tags={allTags}
            selected={selectedTagIds}
            onChange={setSelectedTagIds}
            isDark={isDark}
          />
        )}

        {err && (
          <div style={{ fontSize: '13px', color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '8px 12px' }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#e2e8f0'}`, borderRadius: '8px', padding: '8px 18px', color: isDark ? '#94a3b8' : '#64748b', fontSize: '13px', cursor: 'pointer' }}>Hủy</button>
          <button onClick={handleSubmit} disabled={submitting} style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', borderRadius: '8px', padding: '8px 20px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Đang đăng…' : '🚀 Đăng bài'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── NavBar ───────────────────────────────────────────────────────────────────

function NavBar({ isDark, displayName, email, onNavigate, currentPage, onToggleTheme, onChangePass, onLogout }: {
  isDark: boolean; displayName: string; email: string
  onNavigate: (p: any) => void; currentPage: string
  onToggleTheme?: () => void; onChangePass: () => void; onLogout: () => void
}) {
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: isDark ? 'rgba(2,6,23,0.92)' : 'rgba(255,255,255,0.98)',
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : '#e2e8f0'}`,
      backdropFilter: 'blur(12px)',
      padding: '0 20px', height: '52px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        <button onClick={() => onNavigate('dashboard')} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '8px' }}>
          <span style={{ fontSize: '16px', filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.6))' }}>📡</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '14px', fontWeight: 700, background: 'linear-gradient(90deg, #22d3ee, #818cf8, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}>LSR Engine</span>
        </button>
        <div style={{ display: 'flex', gap: '2px' }}>
          {NAV.map(({ id, label }) => (
            <button key={id} onClick={() => onNavigate(id as any)} style={{
              padding: '4px 11px', borderRadius: '8px', border: 'none',
              background: currentPage === id ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: currentPage === id ? '#818cf8' : 'var(--nav-inactive)',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s', fontFamily: 'Space Grotesk, sans-serif',
              boxShadow: currentPage === id ? 'inset 0 0 0 1px rgba(99,102,241,0.25)' : 'none',
            }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <button onClick={onToggleTheme} style={{ padding: '4px 10px', borderRadius: '8px', flexShrink: 0, border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`, background: isDark ? 'rgba(2,6,23,0.85)' : 'rgba(255,255,255,0.92)', color: isDark ? '#e2e8f0' : '#0f172a', fontSize: '13px', cursor: 'pointer', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
          {isDark ? '☀️' : '🌙'} <span style={{ fontSize: '11px' }}>{isDark ? 'Sáng' : 'Tối'}</span>
        </button>
        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Space Grotesk, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{displayName}</div>
          <div style={{ fontSize: '9px', color: 'var(--nav-email)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{email}</div>
        </div>
        <button onClick={onChangePass} style={{ padding: '4px 10px', borderRadius: '8px', flexShrink: 0, border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: 'var(--nav-logout)', fontSize: '11px', cursor: 'pointer', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 500, whiteSpace: 'nowrap' }}>🔐 Đổi MK</button>
        <button onClick={onLogout} style={{ padding: '4px 10px', borderRadius: '8px', flexShrink: 0, border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: 'var(--nav-logout)', fontSize: '11px', cursor: 'pointer', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 500, whiteSpace: 'nowrap' }}>Đăng xuất</button>
      </div>
    </nav>
  )
}

// ─── Main ForumPage ───────────────────────────────────────────────────────────

export default function ForumPage({ user, authFetch, onLogout, onNavigate, currentPage, theme, onToggleTheme }: Props) {
  const isDark = theme === 'dark'

  const [posts, setPosts]           = useState<ForumPost[]>([])
  const [allTags, setAllTags]       = useState<ForumTag[]>([])
  const [activeTagSlug, setActiveTagSlug] = useState<string>('')
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage]             = useState(1)
  const [sort, setSort]             = useState<SortMode>('newest')
  const [loading, setLoading]       = useState(true)
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showChangePass, setShowChangePass] = useState(false)

  const displayName = user.full_name?.trim() || user.email.split('@')[0]

  // Load tag list once
  useEffect(() => {
    authFetch('/api/forum/tags')
      .then(r => r.json())
      .then((d: any) => { if (d.tags) setAllTags(d.tags) })
      .catch(() => {})
  }, [authFetch])

  const loadPosts = useCallback(async (p = 1, s: SortMode = sort, tagSlug = activeTagSlug) => {
    setLoading(true)
    try {
      const tagParam = tagSlug ? `&tag=${encodeURIComponent(tagSlug)}` : ''
      const res  = await authFetch(`/api/forum/posts?page=${p}&limit=15&sort=${s}${tagParam}`)
      const data = await res.json() as any
      if (res.ok) { setPosts(data.posts); setTotalPages(data.total_pages); setPage(p) }
    } catch {}
    setLoading(false)
  }, [authFetch, sort, activeTagSlug])

  useEffect(() => { loadPosts(1, sort, activeTagSlug) }, [sort, activeTagSlug])

  const handleDelete = async (id: number) => {
    if (!confirm('Bạn có chắc muốn xóa bài viết này?')) return
    try {
      const res = await authFetch(`/api/forum/posts/${id}`, { method: 'DELETE' })
      if (res.ok) setPosts(prev => prev.filter(p => p.id !== id))
    } catch {}
  }

  const handleTagFilter = (slug: string) => {
    if (activeTagSlug === slug) {
      setActiveTagSlug('')
    } else {
      setActiveTagSlug(slug)
      setPage(1)
    }
  }

  const sortBtn = (mode: SortMode, label: string, icon: string) => {
    const active = sort === mode
    return (
      <button key={mode} onClick={() => setSort(mode)} style={{
        padding: '5px 14px', borderRadius: '20px',
        border: `1px solid ${active ? '#6366f1' : (isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0')}`,
        background: active ? (isDark ? 'rgba(99,102,241,0.18)' : '#ede9fe') : (isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc'),
        color: active ? '#818cf8' : (isDark ? '#94a3b8' : '#64748b'),
        fontSize: '12px', fontWeight: active ? 700 : 500, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.15s',
      }}>
        {icon} {label}
      </button>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: isDark
        ? 'linear-gradient(135deg, #020617 0%, #0f0a2e 40%, #0c1a3a 70%, #060e1a 100%)'
        : 'linear-gradient(160deg, #dce3ef 0%, #c9d3e4 50%, #d1dae8 100%)',
      backgroundAttachment: 'fixed',
    }}>
      <NavBar
        isDark={isDark} displayName={displayName} email={user.email}
        onNavigate={onNavigate} currentPage={currentPage}
        onToggleTheme={onToggleTheme}
        onChangePass={() => setShowChangePass(true)}
        onLogout={onLogout}
      />

      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '24px 16px 80px' }}>
        {selectedPostId !== null ? (
          <PostDetail
            postId={selectedPostId} userId={user.id} isDark={isDark} authFetch={authFetch}
            onBack={() => { setSelectedPostId(null); loadPosts(page, sort, activeTagSlug) }}
            onTagClick={handleTagFilter}
          />
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a', margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>
                  💬 Diễn đàn cộng đồng
                </h1>
                <p style={{ fontSize: '13px', color: isDark ? '#64748b' : '#94a3b8', margin: '4px 0 0' }}>
                  Chia sẻ kinh nghiệm và thảo luận cùng cộng đồng học tập
                </p>
              </div>
              <button onClick={() => setShowCreate(true)} style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none', borderRadius: '10px', padding: '9px 18px',
                color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
                boxShadow: '0 2px 8px rgba(99,102,241,0.35)', flexShrink: 0,
              }}>
                ✍️ Viết bài mới
              </button>
            </div>

            {/* Genre filter bar */}
            {allTags.length > 0 && (
              <div style={{
                background: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : '#e2e8f0'}`,
                borderRadius: '12px', padding: '12px 14px', marginBottom: '14px',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '9px' }}>
                  🏷️ Lọc theo thể loại
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {/* "All" pill */}
                  <span
                    onClick={() => handleTagFilter('')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      background: !activeTagSlug ? (isDark ? 'rgba(99,102,241,0.25)' : '#ede9fe') : (isDark ? 'rgba(255,255,255,0.05)' : '#f1f5f9'),
                      border: `1.5px solid ${!activeTagSlug ? '#6366f1' : (isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0')}`,
                      borderRadius: '20px', padding: '3px 11px',
                      fontSize: '12px', fontWeight: !activeTagSlug ? 700 : 500,
                      color: !activeTagSlug ? '#818cf8' : (isDark ? '#94a3b8' : '#64748b'),
                      cursor: 'pointer', userSelect: 'none',
                      boxShadow: !activeTagSlug ? '0 0 0 2px rgba(99,102,241,0.2)' : 'none',
                      transition: 'all 0.12s',
                    }}
                  >
                    ✨ Tất cả
                  </span>
                  {allTags.map(tag => {
                    const active = activeTagSlug === tag.slug
                    return (
                      <span
                        key={tag.id}
                        onClick={() => handleTagFilter(tag.slug)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          background: active ? `${tag.color}30` : (isDark ? 'rgba(255,255,255,0.05)' : '#f1f5f9'),
                          border: `1.5px solid ${active ? tag.color : (isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0')}`,
                          borderRadius: '20px', padding: '3px 11px',
                          fontSize: '12px', fontWeight: active ? 700 : 500,
                          color: active ? tag.color : (isDark ? '#94a3b8' : '#64748b'),
                          cursor: 'pointer', userSelect: 'none',
                          boxShadow: active ? `0 0 0 2px ${tag.color}33` : 'none',
                          transition: 'all 0.12s',
                        }}
                      >
                        {tag.icon} {tag.label}
                      </span>
                    )
                  })}
                </div>
                {activeTagSlug && (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: isDark ? '#64748b' : '#94a3b8' }}>
                    Đang lọc:{' '}
                    <strong style={{ color: allTags.find(t => t.slug === activeTagSlug)?.color }}>
                      {allTags.find(t => t.slug === activeTagSlug)?.icon}{' '}
                      {allTags.find(t => t.slug === activeTagSlug)?.label}
                    </strong>
                    {' — '}
                    <span
                      onClick={() => handleTagFilter('')}
                      style={{ cursor: 'pointer', textDecoration: 'underline', color: isDark ? '#818cf8' : '#6366f1' }}
                    >xóa bộ lọc</span>
                  </div>
                )}
              </div>
            )}

            {/* Sort bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span style={{ fontSize: '12px', color: isDark ? '#64748b' : '#94a3b8', fontWeight: 500 }}>Sắp xếp:</span>
              {sortBtn('newest', 'Mới nhất', '🕐')}
              {sortBtn('top', 'Nhiều tim nhất', '❤️')}
            </div>

            {/* Post list */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: '60px', color: isDark ? '#64748b' : '#94a3b8' }}>Đang tải…</div>
            ) : posts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', background: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : '#e2e8f0'}`, borderRadius: '12px' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>{activeTagSlug ? '🔍' : '💬'}</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: isDark ? '#94a3b8' : '#475569', marginBottom: '6px' }}>
                  {activeTagSlug ? 'Không có bài viết nào trong thể loại này' : 'Chưa có bài viết nào'}
                </div>
                <div style={{ fontSize: '13px', color: isDark ? '#64748b' : '#94a3b8' }}>
                  {activeTagSlug ? (
                    <span onClick={() => handleTagFilter('')} style={{ cursor: 'pointer', color: isDark ? '#818cf8' : '#6366f1', textDecoration: 'underline' }}>Xem tất cả bài viết</span>
                  ) : 'Hãy là người đầu tiên chia sẻ!'}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {posts.map(p => (
                  <PostCard
                    key={p.id} post={p} userId={user.id} isDark={isDark}
                    onClick={() => setSelectedPostId(p.id)}
                    onDelete={handleDelete}
                    onTagClick={handleTagFilter}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '24px' }}>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => loadPosts(p, sort, activeTagSlug)} style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    border: `1px solid ${p === page ? '#818cf8' : (isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0')}`,
                    background: p === page ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: p === page ? '#818cf8' : (isDark ? '#94a3b8' : '#64748b'),
                    fontSize: '13px', fontWeight: p === page ? 700 : 400, cursor: 'pointer',
                  }}>{p}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Watermark */}
      <div style={{ position: 'fixed', bottom: '14px', right: '14px', zIndex: 999, opacity: 0.45, pointerEvents: 'none' }}>
        <img src="/static/and-logo.png" alt="A.N.D" style={{ width: '52px', filter: isDark ? 'brightness(1.2)' : 'none' }} />
      </div>

      {showCreate && (
        <CreatePostModal
          isDark={isDark} authFetch={authFetch}
          onClose={() => setShowCreate(false)}
          onCreated={(post, isPending) => {
            setPosts(prev => [post as ForumPost, ...prev])
            setSelectedPostId(post.id)
          }}
        />
      )}

      {showChangePass && (
        <ChangePasswordModal
          authFetch={authFetch}
          onClose={() => setShowChangePass(false)}
          onSuccess={() => setShowChangePass(false)}
          theme={theme}
        />
      )}

      <ChatBot authFetch={authFetch} theme={theme} user={user} />
    </div>
  )
}
