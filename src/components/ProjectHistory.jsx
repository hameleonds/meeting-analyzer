/**
 * ProjectHistory — lists saved projects and lets the user reopen them.
 *
 * Props:
 *   onOpenProject(project) — called with full project data
 *   onBack()               — return to upload screen
 */
import { useState, useEffect, useCallback } from 'react'
import {
  FiArrowLeft, FiTrash2, FiClock, FiMessageSquare,
  FiFileText, FiLoader, FiAlertCircle, FiInbox,
} from 'react-icons/fi'

const MEETING_TYPE_STYLE = {
  standup:       'bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300',
  planning:      'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300',
  retrospective: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300',
  review:        'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  brainstorm:    'bg-pink-100 dark:bg-pink-500/15 text-pink-700 dark:text-pink-300',
  '1on1':        'bg-teal-100 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300',
  general:       'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
}
const SENTIMENT_STYLE = {
  positive: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  neutral:  'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  negative: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
  mixed:    'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400',
}

function Badge({ label, styleMap }) {
  if (!label) return null
  const cls = styleMap?.[label] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>
      {label}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ProjectHistory({ onOpenProject, onBack }) {
  const [projects,  setProjects]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [opening,   setOpening]   = useState(null) // projectId being opened
  const [deleting,  setDeleting]  = useState(null) // projectId being deleted

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error(`Failed to load projects (${res.status})`)
      setProjects(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  const handleOpen = async (id) => {
    setOpening(id)
    try {
      const res = await fetch(`/api/projects/${id}`)
      if (!res.ok) throw new Error('Could not load project')
      const project = await res.json()
      onOpenProject(project)
    } catch (err) {
      setError(err.message)
    } finally {
      setOpening(null)
    }
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!window.confirm('Delete this project? This cannot be undone.')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setProjects((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
          aria-label="Back"
        >
          <FiArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Project History</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {loading ? 'Loading…' : `${projects.length} saved project${projects.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">
          <FiAlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <FiLoader className="w-6 h-6 text-violet-500 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <FiInbox className="w-8 h-8 text-gray-400 dark:text-gray-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No saved projects yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
            Analyze a meeting and it will appear here automatically.
          </p>
          <button
            onClick={onBack}
            className="mt-6 px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 transition-all shadow-lg shadow-violet-500/20 text-sm"
          >
            Analyze a Meeting
          </button>
        </div>
      )}

      {/* Project list */}
      {!loading && projects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => opening !== p.id && handleOpen(p.id)}
              className="group relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 cursor-pointer hover:border-violet-400 dark:hover:border-violet-500 hover:shadow-lg hover:shadow-violet-500/10 transition-all duration-200 select-none"
            >
              {/* Loading overlay */}
              {opening === p.id && (
                <div className="absolute inset-0 rounded-2xl bg-white/70 dark:bg-gray-900/70 flex items-center justify-center z-10">
                  <FiLoader className="w-5 h-5 text-violet-500 animate-spin" />
                </div>
              )}

              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 dark:text-white leading-snug line-clamp-2">
                    {p.name || 'Untitled Meeting'}
                  </p>
                </div>
                {/* Delete button */}
                <button
                  onClick={(e) => handleDelete(e, p.id)}
                  disabled={deleting === p.id}
                  aria-label="Delete project"
                  className="shrink-0 p-1.5 rounded-lg text-gray-300 dark:text-gray-700 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                >
                  {deleting === p.id
                    ? <FiLoader className="w-3.5 h-3.5 animate-spin" />
                    : <FiTrash2 className="w-3.5 h-3.5" />
                  }
                </button>
              </div>

              {/* Badges */}
              <div className="flex items-center flex-wrap gap-1.5 mb-3">
                {p.meetingType && <Badge label={p.meetingType} styleMap={MEETING_TYPE_STYLE} />}
                {p.sentiment    && <Badge label={p.sentiment}   styleMap={SENTIMENT_STYLE} />}
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span className="flex items-center gap-1">
                  <FiClock className="w-3 h-3" />
                  {formatDate(p.createdAt)}
                </span>
                {p.wordCount && (
                  <span className="flex items-center gap-1">
                    <FiFileText className="w-3 h-3" />
                    {p.wordCount.toLocaleString()} words
                  </span>
                )}
                {p.messageCount > 0 && (
                  <span className="flex items-center gap-1">
                    <FiMessageSquare className="w-3 h-3" />
                    {p.messageCount}
                  </span>
                )}
              </div>

              {p.fileName && (
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-600 truncate">
                  {p.fileName}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
