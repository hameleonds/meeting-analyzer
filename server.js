/**
 * Meeting Analyzer — Express Backend
 *
 * Setup:
 *   1. cp .env.example .env  → fill in ANTHROPIC_API_KEY and OPENAI_API_KEY
 *   2. npm install
 *   3. npm run dev:server    (development with nodemon)
 *      npm start             (production)
 *
 * Endpoints:
 *   POST /api/upload              — Accept MP4 or MP3 (≤5 GB), store in ./uploads, return jobId
 *   POST /api/transcribe          — Call Whisper API; streams progress via SSE
 *   POST /api/analyze             — Call Claude API with transcript, return JSON analysis
 *   GET  /api/status/:jobId       — Return job status object
 *   GET  /api/transcript/:jobId   — Return full transcript text
 *   GET  /api/projects            — List all saved projects (metadata only)
 *   GET  /api/projects/:id        — Get full project (transcript + analysis + messages)
 *   DELETE /api/projects/:id      — Delete a saved project
 *   POST /api/chat/:projectId     — Streaming Claude chat (SSE) for a project
 */

import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import cors from 'cors'
import morgan from 'morgan'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import axios from 'axios'
import FormData from 'form-data'
import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Prevent EPIPE (broken pipe) from crashing the server.
// Happens when a client disconnects while we're still streaming to them,
// or when the outbound Whisper/OpenAI TLS socket closes unexpectedly.
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return
  console.error('[uncaughtException]', err)
  process.exit(1)
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Anthropic Client ──────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express()
const PORT = process.env.PORT || 3001

// ─── In-Memory Job Store ───────────────────────────────────────────────────────
// Maps jobId → job object. Replace with Redis/DB for multi-instance deployments.
const jobs = new Map()

// ─── Upload Directory ──────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads')
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

// ─── Projects Directory ────────────────────────────────────────────────────────
const PROJECTS_DIR = path.join(__dirname, 'data', 'projects')
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true })

// ─── Project Helpers ──────────────────────────────────────────────────────────
function getProjectPath(id) {
  return path.join(PROJECTS_DIR, `${id}.json`)
}

function readProject(id) {
  try {
    return JSON.parse(fs.readFileSync(getProjectPath(id), 'utf8'))
  } catch {
    return null
  }
}

function writeProject(project) {
  fs.writeFileSync(getProjectPath(project.id), JSON.stringify(project, null, 2), 'utf8')
}

function listProjects() {
  try {
    const files = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.json'))
    return files
      .map((f) => {
        try {
          const p = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'))
          return {
            id:          p.id,
            name:        p.name,
            fileName:    p.fileName,
            createdAt:   p.createdAt,
            meetingType: p.analysis?.meetingType ?? null,
            sentiment:   p.analysis?.sentiment?.overall ?? null,
            wordCount:   p.analysis?.wordCount ?? null,
            messageCount: (p.messages ?? []).length,
          }
        } catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  } catch {
    return []
  }
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(morgan('dev'))

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const jobId = uuidv4()
    req.generatedJobId = jobId
    // Sanitise original filename before storing
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    cb(null, `${jobId}_${safeName}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/mp4', 'video/mpeg', 'video/quicktime', 'audio/mpeg', 'audio/mp3', 'audio/x-mp3', 'audio/x-mpeg']
    const name = file.originalname.toLowerCase()
    if (allowed.includes(file.mimetype) || name.endsWith('.mp4') || name.endsWith('.mp3')) {
      cb(null, true)
    } else {
      cb(new Error('Only MP4 and MP3 files are accepted'), false)
    }
  },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function updateJob(jobId, updates) {
  if (!jobs.has(jobId)) return
  jobs.set(jobId, { ...jobs.get(jobId), ...updates, updatedAt: new Date().toISOString() })
}

function createSSESend(res) {
  return (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
    if (typeof res.flush === 'function') res.flush()
  }
}

// ─── POST /api/manual-transcript ─────────────────────────────────────────────
// Creates a job with a pre-supplied transcript — no Whisper call needed.
app.post('/api/manual-transcript', (req, res) => {
  const { transcript } = req.body
  if (!transcript?.trim()) {
    return res.status(400).json({ error: 'transcript is required' })
  }

  const jobId = uuidv4()
  jobs.set(jobId, {
    id:         jobId,
    status:     'transcribed',
    stage:      'Transcript ready',
    progress:   80,
    filePath:   null,
    fileName:   'manual-transcript.txt',
    fileSize:   Buffer.byteLength(transcript, 'utf8'),
    transcript,
    analysis:   null,
    error:      null,
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  })

  res.json({ jobId, message: 'Transcript saved — ready for analysis' })
})

// ─── POST /api/upload ─────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const jobId = req.generatedJobId || uuidv4()

  jobs.set(jobId, {
    id:          jobId,
    status:      'uploaded',
    stage:       'File uploaded successfully',
    progress:    0,
    filePath:    req.file.path,
    fileName:    req.file.originalname,
    fileSize:    req.file.size,
    transcript:  null,
    analysis:    null,
    error:       null,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  })

  res.json({
    jobId,
    message:  'File uploaded successfully',
    fileName: req.file.originalname,
    fileSize: req.file.size,
  })
})

// ─── POST /api/transcribe ─────────────────────────────────────────────────────
// Streams progress via Server-Sent Events (SSE).
// Client should use fetch() + ReadableStream — EventSource only supports GET.
app.post('/api/transcribe', async (req, res) => {
  const { jobId } = req.body

  if (!jobId || !jobs.has(jobId)) {
    return res.status(404).json({ error: 'Job not found' })
  }

  const job = jobs.get(jobId)

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:5173')
  res.flushHeaders()

  // Suppress EPIPE — client may disconnect before the stream ends
  res.socket?.on('error', () => {})

  const send = createSSESend(res)

  // audioPath is set only when we extract a temp MP3 from video (cleaned up in finally).
  // For MP3 uploads we read job.filePath directly and never assign audioPath.
  let audioPath = null

  try {
    const isAudioFile = job.fileName?.toLowerCase().endsWith('.mp3')

    let audioFilePath
    if (isAudioFile) {
      // MP3 uploaded — skip extraction, send directly to Whisper
      updateJob(jobId, { status: 'processing', stage: 'Preparing transcription…', progress: 18 })
      send({ stage: 'Preparing transcription…', progress: 18, status: 'processing' })
      audioFilePath = job.filePath
    } else {
      // Stage 1 — extract audio from video with ffmpeg
      updateJob(jobId, { status: 'processing', stage: 'Extracting audio…', progress: 10 })
      send({ stage: 'Extracting audio…', progress: 10, status: 'processing' })

      audioPath = path.join(UPLOADS_DIR, `${jobId}_audio.mp3`)
      await execFileAsync('ffmpeg', [
        '-i', job.filePath,
        '-vn',                  // no video
        '-acodec', 'libmp3lame',
        '-q:a', '5',            // ~128 kbps — good quality/size balance
        '-y',                   // overwrite if exists
        audioPath,
      ])
      audioFilePath = audioPath

      // Stage 2 — preparing request
      updateJob(jobId, { stage: 'Preparing transcription…', progress: 18 })
      send({ stage: 'Preparing transcription…', progress: 18, status: 'processing' })
    }

    const audioSizeMB = fs.statSync(audioFilePath).size / (1024 * 1024)
    console.log(`[transcribe] audio ready: ${audioSizeMB.toFixed(1)} MB`)

    // Whisper API limit is 25 MB — warn but still try (it may still work for files slightly over)
    if (audioSizeMB > 25) {
      console.warn(`[transcribe] audio is ${audioSizeMB.toFixed(1)} MB — exceeds Whisper 25 MB limit`)
    }

    // Build multipart form for Whisper
    const formData = new FormData()
    formData.append('file', fs.createReadStream(audioFilePath), {
      filename: `${jobId}.mp3`,
      contentType: 'audio/mpeg',
    })
    formData.append('model', 'whisper-1')
    formData.append('response_format', 'verbose_json')

    // Simulate incremental progress while we wait for Whisper
    let simProgress = 22
    const ticker = setInterval(() => {
      simProgress = Math.min(simProgress + Math.random() * 6, 72)
      const p = Math.round(simProgress)
      updateJob(jobId, { stage: `Transcribing (${p}%)`, progress: p })
      send({ stage: `Transcribing (${p}%)`, progress: p, status: 'processing' })
    }, 1800)

    // Stage 3 — call Whisper
    const whisperRes = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        maxContentLength: Infinity,
        maxBodyLength:    Infinity,
        timeout:          600_000, // 10 min for large files
      }
    )
    clearInterval(ticker)

    const transcript = whisperRes.data?.text ?? String(whisperRes.data)

    // Stage 4 — done
    updateJob(jobId, { status: 'transcribed', stage: 'Transcription complete', progress: 80, transcript })
    send({ stage: 'Transcription complete', progress: 80, status: 'transcribed', transcript })

    res.end()
  } catch (err) {
    // Log the full Whisper error body so we can see exactly what went wrong
    const whisperDetail = err.response?.data
    if (whisperDetail) console.error('[transcribe] Whisper response:', JSON.stringify(whisperDetail))

    const status = err.response?.status
    const baseMsg = err.response?.data?.error?.message ?? err.message ?? 'Transcription failed'
    const msg = status === 500
      ? `OpenAI Whisper server error (500) — this is usually transient. Please try again.`
      : status === 413
      ? `Audio file too large for Whisper API (max 25 MB). Try a shorter recording.`
      : baseMsg
    console.error('[transcribe] error:', msg)
    updateJob(jobId, { status: 'error', error: msg, stage: 'Transcription failed' })
    try { send({ stage: 'Transcription failed', progress: 0, status: 'error', error: msg }) } catch {}
    try { res.end() } catch {}
  } finally {
    // Clean up temp audio file
    if (audioPath) {
      try { fs.unlinkSync(audioPath) } catch {}
    }
  }
})

// ─── POST /api/analyze ────────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { jobId } = req.body

  if (!jobId || !jobs.has(jobId)) {
    return res.status(404).json({ error: 'Job not found' })
  }

  const job = jobs.get(jobId)

  if (!job.transcript) {
    return res.status(400).json({ error: 'No transcript available — run transcription first' })
  }

  updateJob(jobId, { status: 'analyzing', stage: 'Analyzing meeting…', progress: 85 })

  try {
    const wordCount = job.transcript.split(/\s+/).filter(Boolean).length

    // Use streaming to avoid HTTP timeout on long transcripts
    const stream = anthropic.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are an expert meeting analyst. Return ONLY valid JSON — no markdown fences, no prose.`,
      messages: [{
        role:    'user',
        content: `Analyze this meeting transcript and return a JSON object with the exact schema below.

TRANSCRIPT:
${job.transcript}

SCHEMA (return only valid JSON matching this shape — all fields required):
{
  "summary": "2-3 sentence executive summary",
  "meetingType": "standup|planning|retrospective|review|brainstorm|1on1|general",
  "estimatedDuration": "e.g. '45 minutes' or null",
  "participants": [
    { "name": "string", "role": "inferred role or null" }
  ],
  "keyTopics": [
    { "topic": "string", "description": "string", "timeSpent": "estimated % of meeting" }
  ],
  "decisions": [
    { "decision": "string", "owner": "string or null", "rationale": "string or null" }
  ],
  "actionItems": [
    { "task": "string", "assignee": "string or Unassigned", "dueDate": "string or null", "priority": "high|medium|low" }
  ],
  "followUpQuestions": ["string"],
  "sentiment": {
    "overall": "positive|neutral|negative|mixed",
    "score": 0.0,
    "notes": "string"
  },
  "risks": [
    { "risk": "string", "severity": "high|medium|low" }
  ],
  "insights": ["string"],
  "wordCount": ${wordCount},
  "analyzedAt": "${new Date().toISOString()}"
}`,
      }],
    })

    const message = await stream.finalMessage()
    let raw = message.content[0]?.text?.trim() ?? ''

    // Strip accidental markdown code fences
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    let analysis
    try {
      analysis = JSON.parse(raw)
    } catch {
      // Return as-is so the client can still display something
      analysis = { rawAnalysis: raw, parseError: 'Response was not valid JSON', analyzedAt: new Date().toISOString() }
    }

    updateJob(jobId, { status: 'complete', stage: 'Analysis complete', progress: 100, analysis })

    // ── Auto-save project to disk ──────────────────────────────────────────────
    try {
      const projectName = (analysis.summary ?? '').slice(0, 80) || job.fileName || 'Untitled Meeting'
      writeProject({
        id:          jobId,
        name:        projectName,
        fileName:    job.fileName || 'manual-transcript.txt',
        createdAt:   job.createdAt,
        updatedAt:   new Date().toISOString(),
        transcript:  job.transcript,
        analysis,
        messages:    [],
      })
    } catch (saveErr) {
      console.error('[analyze] project save failed:', saveErr.message)
    }

    res.json({ jobId, analysis, status: 'complete' })
  } catch (err) {
    console.error('[analyze]', err.message)
    const msg = err.message || 'Analysis failed'
    updateJob(jobId, { status: 'error', error: msg, stage: 'Analysis failed' })
    res.status(500).json({ error: msg })
  }
})

// ─── GET /api/status/:jobId ───────────────────────────────────────────────────
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })

  // Omit full transcript from status — fetch it separately if needed
  const { transcript, ...rest } = job
  res.json({ ...rest, hasTranscript: !!transcript, transcriptLength: transcript?.length ?? 0 })
})

// ─── GET /api/transcript/:jobId ───────────────────────────────────────────────
app.get('/api/transcript/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job)             return res.status(404).json({ error: 'Job not found' })
  if (!job.transcript)  return res.status(404).json({ error: 'Transcript not yet available' })
  res.json({ jobId: req.params.jobId, transcript: job.transcript })
})

// ─── GET /api/projects ────────────────────────────────────────────────────────
app.get('/api/projects', (_req, res) => {
  res.json(listProjects())
})

// ─── GET /api/projects/:id ────────────────────────────────────────────────────
app.get('/api/projects/:id', (req, res) => {
  const project = readProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  res.json(project)
})

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────
app.delete('/api/projects/:id', (req, res) => {
  const p = getProjectPath(req.params.id)
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Project not found' })
  fs.unlinkSync(p)
  res.json({ success: true })
})

// ─── POST /api/chat/:projectId ────────────────────────────────────────────────
// Streams a Claude response as SSE. Each event: data: { type: 'delta', text }
// Final event:                               data: { type: 'done',  fullText }
app.post('/api/chat/:projectId', async (req, res) => {
  const { message } = req.body
  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' })
  }

  const project = readProject(req.params.projectId)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:5173')
  res.flushHeaders()
  res.socket?.on('error', () => {})

  const send = createSSESend(res)

  // Append user message
  const userMsg = { role: 'user', content: message.trim(), ts: new Date().toISOString() }
  project.messages.push(userMsg)

  // Build messages array for Claude (role must be 'user'|'assistant', no 'ts')
  const claudeMessages = project.messages.map(({ role, content }) => ({ role, content }))

  try {
    const stream = anthropic.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are a helpful assistant analyzing a meeting. You have access to the full transcript and AI-generated analysis below.

MEETING TRANSCRIPT:
${project.transcript}

MEETING ANALYSIS (JSON):
${JSON.stringify(project.analysis, null, 2)}

Answer questions about this meeting clearly and concisely. Reference specific parts of the transcript or analysis when relevant.`,
      messages: claudeMessages,
    })

    let fullText = ''

    stream.on('text', (text) => {
      fullText += text
      try { send({ type: 'delta', text }) } catch {}
    })

    await stream.finalMessage()

    // Append assistant message and persist
    project.messages.push({ role: 'assistant', content: fullText, ts: new Date().toISOString() })
    project.updatedAt = new Date().toISOString()
    try { writeProject(project) } catch (e) { console.error('[chat] save failed:', e.message) }

    try { send({ type: 'done', fullText }) } catch {}
    try { res.end() } catch {}
  } catch (err) {
    console.error('[chat]', err.message)
    try { send({ type: 'error', error: err.message || 'Chat failed' }) } catch {}
    try { res.end() } catch {}
  }
})

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large — maximum size is 5 GB' })
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` })
  }
  res.status(500).json({ error: err.message || 'Internal server error' })
})

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Meeting Analyzer API  →  http://localhost:${PORT}`)
  console.log(`  Uploads directory     →  ${UPLOADS_DIR}`)
  console.log(`  Projects directory    →  ${PROJECTS_DIR}\n`)
})
