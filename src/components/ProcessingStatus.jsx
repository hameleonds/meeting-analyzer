/**
 * ProcessingStatus — runs the pipeline and shows live progress.
 *
 * When skipTranscription=false  (MP4 upload):
 *   Stage 1: POST /api/transcribe  → SSE stream (progress 0–80)
 *   Stage 2: POST /api/analyze     → JSON response (progress 80–100)
 *
 * When skipTranscription=true  (manual transcript):
 *   Fetches transcript from job, goes straight to Claude (progress 80–100)
 *
 * Calls onComplete({ analysis, transcript }) when done.
 */
import { useEffect, useRef, useState } from 'react'
import { FiLoader, FiCheckCircle, FiAlertCircle } from 'react-icons/fi'

const STAGES_FULL = [
  { key: 'upload',     label: 'File uploaded',             threshold: 0   },
  { key: 'extract',    label: 'Extracting audio',           threshold: 10  },
  { key: 'transcribe', label: 'Transcribing with Whisper',  threshold: 20  },
  { key: 'analyze',    label: 'Analyzing with Claude',      threshold: 80  },
  { key: 'complete',   label: 'Analysis complete',          threshold: 100 },
]

const STAGES_SKIP = [
  { key: 'ready',    label: 'Transcript ready',          threshold: 0   },
  { key: 'analyze',  label: 'Analyzing with Claude',     threshold: 80  },
  { key: 'complete', label: 'Analysis complete',         threshold: 100 },
]

export default function ProcessingStatus({ jobId, skipTranscription = false, onComplete, onError }) {
  const [progress,  setProgress]  = useState(skipTranscription ? 80 : 0)
  const [stageText, setStageText] = useState(skipTranscription ? 'Analyzing meeting…' : 'Starting…')
  const [status,    setStatus]    = useState('running') // 'running' | 'complete' | 'error'
  const transcriptRef = useRef(null)
  const didRun = useRef(false)

  const STAGES = skipTranscription ? STAGES_SKIP : STAGES_FULL

  useEffect(() => {
    if (didRun.current) return
    didRun.current = true
    runPipeline()
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runPipeline() {
    try {
      if (skipTranscription) {
        // Transcript already exists — fetch it then analyze
        const res = await fetch(`/api/transcript/${jobId}`)
        if (!res.ok) throw new Error('Could not retrieve transcript')
        const { transcript } = await res.json()
        transcriptRef.current = transcript
      } else {
        // Stage 1: transcription via SSE
        await streamTranscription()
      }

      // Stage 2: analysis
      setStageText('Analyzing meeting…')
      setProgress(85)

      const analyzeRes = await fetch('/api/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId }),
      })

      if (!analyzeRes.ok) {
        const body = await analyzeRes.json().catch(() => ({}))
        throw new Error(body.error || `Analysis failed (${analyzeRes.status})`)
      }

      const { analysis } = await analyzeRes.json()

      setProgress(100)
      setStageText('Analysis complete!')
      setStatus('complete')

      await sleep(600)
      onComplete({ analysis, transcript: transcriptRef.current })
    } catch (err) {
      setStatus('error')
      onError(err.message)
    }
  }

  async function streamTranscription() {
    const res = await fetch('/api/transcribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jobId }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Transcription failed (${res.status})`)
    }

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let   buffer  = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        let event
        try {
          event = JSON.parse(line.slice(6))
        } catch {
          continue // skip genuinely malformed SSE lines
        }
        // Propagate server-side errors immediately
        if (event.status === 'error') throw new Error(event.error || 'Transcription failed')
        if (event.stage)    setStageText(event.stage)
        if (event.progress) setProgress(event.progress)
        if (event.status === 'transcribed' && event.transcript) {
          transcriptRef.current = event.transcript
        }
      }
    }

    if (!transcriptRef.current) throw new Error('No transcript received from server')
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  const barColor = status === 'error'
    ? 'from-red-500 to-rose-500'
    : status === 'complete'
      ? 'from-emerald-500 to-teal-500'
      : 'from-violet-500 to-indigo-500'

  const activeIdx = STAGES.findLastIndex((s) => progress >= s.threshold)

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-8 sm:p-10 space-y-8">

        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {status === 'complete' ? 'Done!'
              : status === 'error' ? 'Something went wrong'
              : 'Processing…'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {status === 'running'  && 'Please keep this tab open.'}
            {status === 'complete' && 'Your analysis is ready.'}
            {status === 'error'    && 'Check the error above and try again.'}
          </p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span className="truncate max-w-[70%]">{stageText}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-700 ease-out`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Stage checklist */}
        <ol className="space-y-3">
          {STAGES.map((s, i) => {
            const done    = i < activeIdx || status === 'complete'
            const active  = i === activeIdx && status === 'running'
            const errored = status === 'error' && i === activeIdx

            return (
              <li key={s.key} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  errored ? 'text-red-500'
                  : done   ? 'text-emerald-500'
                  : active ? 'text-violet-500'
                  : 'text-gray-300 dark:text-gray-700'
                }`}>
                  {errored
                    ? <FiAlertCircle className="w-5 h-5" />
                    : done
                      ? <FiCheckCircle className="w-5 h-5" />
                      : active
                        ? <FiLoader className="w-5 h-5 animate-spin" />
                        : <span className="w-2 h-2 rounded-full bg-current inline-block" />
                  }
                </div>
                <span className={`text-sm font-medium transition-colors ${
                  errored ? 'text-red-500'
                  : done   ? 'text-gray-700 dark:text-gray-300'
                  : active ? 'text-gray-900 dark:text-white'
                  : 'text-gray-400 dark:text-gray-600'
                }`}>
                  {s.label}
                </span>
              </li>
            )
          })}
        </ol>

      </div>
    </div>
  )
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
