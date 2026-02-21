/**
 * UploadZone — two input modes:
 *   "Upload File"      — drag-drop or browse MP4/MP3, POSTs to /api/upload (requires OPENAI_API_KEY)
 *   "Paste Transcript" — textarea, POSTs to /api/manual-transcript (Anthropic-only)
 *
 * Validates: MP4 or MP3, ≤ 5 GB.
 * Calls onUploadComplete(jobId, { skipTranscription }) on success.
 */
import { useState, useRef, useCallback } from 'react'
import {
  FiUploadCloud, FiFile, FiX, FiCheck,
  FiAlertCircle, FiFileText,
} from 'react-icons/fi'

const MAX_GB    = 5
const MAX_MB    = MAX_GB * 1024
const MAX_BYTES = MAX_GB * 1024 * 1024 * 1024

function formatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

// ── File Upload panel (MP4 or MP3) ────────────────────────────────────────────
function FileUploadPanel({ onUploadComplete, onError }) {
  const [dragging,    setDragging]    = useState(false)
  const [file,        setFile]        = useState(null)
  const [fileError,   setFileError]   = useState(null)
  const [uploading,   setUploading]   = useState(false)
  const [uploadPct,   setUploadPct]   = useState(0)
  const inputRef = useRef(null)

  function validate(f) {
    if (!f) return 'No file selected'
    const name = f.name.toLowerCase()
    const isMp4 = f.type === 'video/mp4' || name.endsWith('.mp4')
    const isMp3 = f.type === 'audio/mpeg' || f.type === 'audio/mp3' || name.endsWith('.mp3')
    if (!isMp4 && !isMp3) return 'Only MP4 and MP3 files are accepted'
    if (f.size > MAX_BYTES) return `File exceeds ${MAX_GB} GB (yours: ${formatBytes(f.size)})`
    return null
  }

  const acceptFile = useCallback((f) => {
    const err = validate(f)
    if (err) { setFileError(err); setFile(null) }
    else     { setFileError(null); setFile(f) }
  }, [])

  const onDragOver  = (e) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = (e) => { e.preventDefault(); setDragging(false) }
  const onDrop      = (e) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) acceptFile(f)
  }
  const onInputChange = (e) => { const f = e.target.files?.[0]; if (f) acceptFile(f) }
  const clearFile = () => { setFile(null); setFileError(null); setUploadPct(0) }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true); setUploadPct(0)
    const formData = new FormData()
    formData.append('video', file)

    try {
      const { jobId } = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/upload')
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setUploadPct(Math.round(e.loaded / e.total * 100))
        })
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText))
          } else {
            let msg = `Upload failed (${xhr.status})`
            try { msg = JSON.parse(xhr.responseText)?.error || msg } catch {}
            reject(new Error(msg))
          }
        })
        xhr.addEventListener('error', () => reject(new Error('Network error')))
        xhr.send(formData)
      })
      onUploadComplete(jobId, { skipTranscription: false })
    } catch (err) {
      onError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button" tabIndex={0}
        aria-label="Drop zone — drag and drop or click to browse"
        onClick={() => !file && inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && !file && inputRef.current?.click()}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        className={`
          relative cursor-pointer select-none rounded-2xl border-2 border-dashed p-10 sm:p-14 text-center
          transition-all duration-200 outline-none
          focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950
          ${dragging
            ? 'border-violet-500 bg-violet-500/5 dark:bg-violet-500/10 scale-[1.01]'
            : file
              ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-500/5 cursor-default'
              : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-violet-400 dark:hover:border-violet-500 hover:bg-violet-50/30 dark:hover:bg-violet-500/5'
          }
        `}
      >
        <input ref={inputRef} type="file" accept="video/mp4,.mp4,audio/mpeg,.mp3" className="hidden" onChange={onInputChange} />

        {file ? (
          <div className="space-y-3 animate-fade-in">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-500/15 mx-auto">
              <FiCheck className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-base truncate max-w-xs mx-auto">{file.name}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{formatBytes(file.size)}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); clearFile() }}
              className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              <FiX className="w-4 h-4" /> Remove
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mx-auto transition-colors ${
              dragging ? 'bg-violet-100 dark:bg-violet-500/20' : 'bg-gray-100 dark:bg-gray-800'
            }`}>
              <FiUploadCloud className={`w-8 h-8 transition-colors ${
                dragging ? 'text-violet-600 dark:text-violet-400' : 'text-gray-400 dark:text-gray-500'
              }`} />
            </div>
            <div>
              <p className="font-semibold text-gray-700 dark:text-gray-200 text-base">
                {dragging ? 'Drop your recording here' : 'Drag & drop your recording'}
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                or <span className="text-violet-600 dark:text-violet-400 font-medium">click to browse</span>
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <FiFile className="w-3 h-3" /> MP4 / MP3
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                Max {MAX_GB} GB
              </span>
            </div>
          </div>
        )}
      </div>

      {fileError && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm animate-fade-in">
          <FiAlertCircle className="w-4 h-4 shrink-0" />{fileError}
        </div>
      )}

      {file && !fileError && (
        <div className="space-y-3 animate-fade-in">
          {uploading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Uploading…</span><span>{uploadPct}%</span>
              </div>
              <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            </div>
          )}
          <button
            onClick={handleUpload} disabled={uploading}
            className="w-full py-3 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.99] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
          >
            {uploading ? 'Uploading…' : 'Analyze Recording'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Paste Transcript panel ────────────────────────────────────────────────────
function TranscriptPanel({ onUploadComplete, onError }) {
  const [text,      setText]      = useState('')
  const [loading,   setLoading]   = useState(false)
  const MIN_CHARS = 50

  const handleSubmit = async () => {
    if (text.trim().length < MIN_CHARS) return
    setLoading(true)
    try {
      const res = await fetch('/api/manual-transcript', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transcript: text.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to save transcript')
      }
      const { jobId } = await res.json()
      onUploadComplete(jobId, { skipTranscription: true })
    } catch (err) {
      onError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const tooShort = text.trim().length > 0 && text.trim().length < MIN_CHARS

  return (
    <div className="space-y-4">
      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your meeting transcript here…"
          rows={10}
          className="w-full px-4 py-3 rounded-xl text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-600 resize-y transition-colors"
        />
        <div className="flex justify-between mt-1.5 text-xs text-gray-400 dark:text-gray-500">
          <span>{tooShort ? `At least ${MIN_CHARS} characters required` : ' '}</span>
          <span>{text.length.toLocaleString()} chars</span>
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-xl bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 text-sky-700 dark:text-sky-400 text-xs">
        <FiFileText className="w-4 h-4 shrink-0 mt-0.5" />
        <span>No <code className="font-mono">OPENAI_API_KEY</code> needed — transcript goes straight to Claude for analysis.</span>
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading || text.trim().length < MIN_CHARS}
        className="w-full py-3 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.99] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
      >
        {loading ? 'Saving…' : 'Analyze Transcript'}
      </button>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function UploadZone({ onUploadComplete, onError }) {
  const [tab, setTab] = useState('file') // 'file' | 'transcript'

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/60">
        <Tab active={tab === 'file'}       onClick={() => setTab('file')}>
          Upload File
        </Tab>
        <Tab active={tab === 'transcript'} onClick={() => setTab('transcript')}>
          Paste Transcript
        </Tab>
      </div>

      {tab === 'file'
        ? <FileUploadPanel onUploadComplete={onUploadComplete} onError={onError} />
        : <TranscriptPanel onUploadComplete={onUploadComplete} onError={onError} />
      }
    </div>
  )
}
