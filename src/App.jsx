/**
 * App — root component, owns global state and routing between stages.
 *
 * Stages:
 *   upload     → user drops / selects an MP4 or pastes a transcript
 *   processing → transcription + analysis running
 *   results    → analysis displayed (with chat)
 *   history    → list of saved projects
 */
import { useState, useCallback } from 'react'
import { FiVideo, FiSun, FiMoon, FiClock } from 'react-icons/fi'
import UploadZone from './components/UploadZone.jsx'
import ProcessingStatus from './components/ProcessingStatus.jsx'
import ResultsDisplay from './components/ResultsDisplay.jsx'
import ProjectHistory from './components/ProjectHistory.jsx'

export default function App() {
  const [dark,     setDark]     = useState(true)    // dark mode on by default
  const [stage,    setStage]    = useState('upload') // 'upload' | 'processing' | 'results' | 'history'
  const [jobId,    setJobId]    = useState(null)
  const [skipTranscription, setSkipTranscription] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [transcript, setTranscript] = useState(null)
  const [projectId,  setProjectId]  = useState(null)
  const [initialMessages, setInitialMessages] = useState([])
  const [error,    setError]    = useState(null)

  const handleUploadComplete = useCallback((id, { skipTranscription: skip = false } = {}) => {
    setJobId(id)
    setSkipTranscription(skip)
    setError(null)
    setStage('processing')
  }, [])

  const handleProcessingComplete = useCallback(({ analysis, transcript }) => {
    setAnalysis(analysis)
    setTranscript(transcript)
    setProjectId(jobId) // jobId == projectId (auto-saved server-side after analyze)
    setInitialMessages([])
    setStage('results')
  }, [jobId])

  const handleError = useCallback((msg) => setError(msg), [])

  const handleReset = useCallback(() => {
    setStage('upload')
    setJobId(null)
    setSkipTranscription(false)
    setAnalysis(null)
    setTranscript(null)
    setProjectId(null)
    setInitialMessages([])
    setError(null)
  }, [])

  const handleOpenProject = useCallback((project) => {
    setAnalysis(project.analysis)
    setTranscript(project.transcript)
    setProjectId(project.id)
    setInitialMessages(project.messages ?? [])
    setError(null)
    setStage('results')
  }, [])

  const stageLabels = ['upload', 'processing', 'results']

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors duration-300 flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            {/* Logo */}
            <button onClick={handleReset} className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25 group-hover:shadow-violet-500/40 transition-shadow">
                <FiVideo className="w-5 h-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-bold text-gray-900 dark:text-white leading-tight">Meeting Analyzer</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">Whisper + Claude</p>
              </div>
            </button>

            {/* Step indicator — only for the main flow stages */}
            {stage !== 'history' && (
              <div className="hidden md:flex items-center gap-1 text-xs">
                {stageLabels.map((s, i) => (
                  <div key={s} className="flex items-center gap-1">
                    {i > 0 && <div className="w-6 h-px bg-gray-300 dark:bg-gray-700" />}
                    <span className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
                      stage === s
                        ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                        : 'text-gray-400 dark:text-gray-600'
                    }`}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Right side: History button + theme toggle */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setStage('history')}
                aria-label="View history"
                className={`p-2 rounded-lg transition-all ${
                  stage === 'history'
                    ? 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <FiClock className="w-5 h-5" />
              </button>
              <button
                onClick={() => setDark((d) => !d)}
                aria-label="Toggle theme"
                className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
              >
                {dark ? <FiSun className="w-5 h-5" /> : <FiMoon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </header>

        {/* ── Main ───────────────────────────────────────────────────── */}
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 sm:py-14">

          {/* Error banner */}
          {error && (
            <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 animate-fade-in">
              <span className="text-lg mt-0.5 shrink-0">⚠</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Processing Error</p>
                <p className="text-sm mt-0.5 opacity-80 break-words">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors text-lg leading-none"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          {/* ── History stage ─────────────────────────────────────────── */}
          {stage === 'history' && (
            <ProjectHistory
              onOpenProject={handleOpenProject}
              onBack={() => setStage('upload')}
            />
          )}

          {/* ── Upload stage ─────────────────────────────────────────── */}
          {stage === 'upload' && (
            <div className="animate-fade-in">
              <div className="text-center mb-10">
                <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-3">
                  Analyze Your Meeting
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-base sm:text-lg max-w-lg mx-auto leading-relaxed">
                  Drop an MP4 recording and get AI-powered insights — transcript, action items, decisions, sentiment, and more.
                </p>
              </div>
              <UploadZone onUploadComplete={handleUploadComplete} onError={handleError} />
            </div>
          )}

          {/* ── Processing stage ─────────────────────────────────────── */}
          {stage === 'processing' && jobId && (
            <ProcessingStatus
              jobId={jobId}
              skipTranscription={skipTranscription}
              onComplete={handleProcessingComplete}
              onError={handleError}
            />
          )}

          {/* ── Results stage ─────────────────────────────────────────── */}
          {stage === 'results' && analysis && (
            <ResultsDisplay
              analysis={analysis}
              transcript={transcript}
              projectId={projectId}
              initialMessages={initialMessages}
              onReset={handleReset}
            />
          )}
        </main>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <footer className="border-t border-gray-200 dark:border-gray-800 py-5">
          <p className="text-center text-xs text-gray-400 dark:text-gray-600">
            Meeting Analyzer — Transcription by OpenAI Whisper · Analysis by Anthropic Claude
          </p>
        </footer>

      </div>
    </div>
  )
}
