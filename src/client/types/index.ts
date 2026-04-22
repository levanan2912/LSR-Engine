export interface User {
  id: number
  email: string
  full_name: string
  must_change_password?: boolean
}

export interface DailyEntry {
  id: number
  user_id: number
  session_date: string
  session_number: number      // which session of the day (1, 2, 3...)
  session_time: string | null // start time "HH:MM", nullable
  study_hours: number
  focus_level: number
  distraction_count: number
  distracting_factors: string
  goal_achieved: number
  emotional_state: string
  dropout_feeling: number
  created_at: string
}

export interface AnalysisReport {
  id: number
  user_id: number
  entry_id: number
  report_date: string

  // Core classification
  risk_level: 'Stable' | 'Fluctuating' | 'High Risk'

  // JSON-parsed arrays
  key_signals: string[]
  action_plan_48h: string[]

  // Narrative fields
  short_term_forecast: string
  primary_risk_driver: string
  intervention_strategy: string

  // Monitoring
  monitoring_protocol: string

  // Raw AI response (for debug/audit)
  raw_ai_response?: string | null

  // Model that produced this report (e.g. 'gemini-3-flash-preview_success', 'rule_based_fallback')
  analyzed_by?: string | null
  // Friendly name of the API key used (e.g. 'June')
  key_name?: string | null

  // Meta
  created_at: string

  // Joined from daily_entries
  study_hours?: number
  focus_level?: number
  dropout_feeling?: number
  distraction_count?: number
  distracting_factors?: string
  emotional_state?: string
  session_date?: string
  session_number?: number
  session_time?: string | null
}

// ─── History API types ────────────────────────────────────────────────────────

export interface SessionReport {
  id: number
  risk_level: 'Stable' | 'Fluctuating' | 'High Risk'
  key_signals: string[]
  short_term_forecast: string
  primary_risk_driver: string
  intervention_strategy: string
  action_plan_48h: string[]
  monitoring_protocol: string
  raw_ai_response?: string | null
  analyzed_by?: string | null
  key_name?: string | null
  created_at: string
}

export interface SessionWithReport {
  id: number
  session_date: string
  session_number: number
  session_time: string | null
  study_hours: number
  focus_level: number
  distraction_count: number
  distracting_factors: string | null
  goal_achieved: number
  emotional_state: string | null
  dropout_feeling: number
  created_at: string
  report: SessionReport | null
}

export interface HistoryData {
  sessions: SessionWithReport[]
  grouped_by_date: Record<string, SessionWithReport[]>
  total_sessions: number
  total_days: number
}

// ─── Forum types ──────────────────────────────────────────────────────────────

export interface ForumTag {
  id: number
  slug: string
  label: string
  color: string
  icon: string
  sort_order?: number
}

export interface ForumPost {
  id: number
  user_id: number
  title: string
  content: string
  created_at: string
  updated_at: string
  author_name: string
  author_email: string
  comment_count: number
  like_count: number
  tags: ForumTag[]
}

export interface ForumComment {
  id: number
  post_id: number
  user_id: number
  parent_id: number | null
  content: string
  created_at: string
  author_name: string
  author_email: string
}

export interface ForumListResponse {
  posts: ForumPost[]
  total: number
  page: number
  limit: number
  total_pages: number
}

export interface EntryFormData {
  study_hours: number
  focus_level: number
  distraction_count: number
  distracting_factors: string
  goal_achieved: boolean
  emotional_state: string
  dropout_feeling: number
  session_number?: number      // optional, default 1
  session_time?: string        // optional, "HH:MM"
}
