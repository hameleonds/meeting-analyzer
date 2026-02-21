/**
 * ResultsDisplay — renders structured analysis from Claude.
 *
 * Features:
 *  - Overview cards (meeting type, sentiment, word count, participants)
 *  - Section cards: Summary, Key Topics, Action Items, Decisions, Risks, Insights
 *  - Full raw JSON viewer with syntax highlighting
 *  - Copy-to-clipboard on every section
 *  - Transcript toggle
 *  - "Analyze Another" reset button
 */
import { useState, useCallback } from 'react'
import {
  FiCopy, FiCheck, FiChevronDown, FiChevronUp,
  FiRefreshCw, FiAlertTriangle, FiZap,
  FiList, FiMessageSquare, FiUsers, FiTarget,
  FiCode, FiFileText, FiCpu,
} from 'react-icons/fi'
import ChatPanel from './ChatPanel.jsx'

// ── Clipboard helper ──────────────────────────────────────────────────────────
function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [])
  return [copied, copy]
}

function CopyButton({ text, size = 'sm' }) {
  const [copied, copy] = useCopy()
  return (
    <button
      onClick={(e) => { e.stopPropagation(); copy(text) }}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      className={`inline-flex items-center gap-1 rounded-lg transition-all ${
        size === 'sm' ? 'p-1.5 text-xs' : 'px-2.5 py-1.5 text-xs font-medium'
      } ${
        copied
          ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
          : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {copied ? <FiCheck className="w-3.5 h-3.5" /> : <FiCopy className="w-3.5 h-3.5" />}
      {size !== 'sm' && (copied ? 'Copied' : 'Copy')}
    </button>
  )
}

// ── Section card wrapper ──────────────────────────────────────────────────────
function Section({ icon: Icon, title, copyText, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* div instead of button — CopyButton inside is already a button */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2.5">
          <Icon className="w-4 h-4 text-violet-500 dark:text-violet-400 shrink-0" />
          <span className="font-semibold text-sm text-gray-900 dark:text-white">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {copyText && <CopyButton text={copyText} size="sm" />}
          {open
            ? <FiChevronUp   className="w-4 h-4 text-gray-400" />
            : <FiChevronDown className="w-4 h-4 text-gray-400" />
          }
        </div>
      </div>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
const PRIORITY_STYLE = {
  high:   'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
  medium: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  low:    'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
}
const SEVERITY_STYLE = {
  high:   'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
  medium: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  low:    'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
}
const SENTIMENT_STYLE = {
  positive: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  neutral:  'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  negative: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
  mixed:    'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400',
}

function Badge({ label, styleMap, value }) {
  const cls = styleMap?.[value?.toLowerCase()] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${cls}`}>
      {label ?? value}
    </span>
  )
}

// ── Syntax-highlighted JSON viewer ────────────────────────────────────────────
function JsonViewer({ data }) {
  const highlighted = syntaxHighlight(JSON.stringify(data, null, 2))
  return (
    <pre
      className="text-xs leading-relaxed overflow-auto rounded-xl bg-gray-950 dark:bg-black p-4 max-h-[500px] border border-gray-800"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  )
}

function syntaxHighlight(json) {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number'
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'json-key' : 'json-string'
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean'
        } else if (/null/.test(match)) {
          cls = 'json-null'
        }
        return `<span class="${cls}">${match}</span>`
      }
    )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ResultsDisplay({ analysis: a, transcript, projectId, initialMessages = [], onReset }) {
  const [showTranscript, setShowTranscript] = useState(false)
  const [showRaw,        setShowRaw]        = useState(false)
  const [copied, copy] = useCopy()

  if (!a) return null

  const fullJson = JSON.stringify(a, null, 2)

  return (
    <div className="space-y-5 animate-slide-up">

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Meeting Analysis</h2>
          {a.analyzedAt && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Analyzed {new Date(a.analyzedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => copy(fullJson)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-gray-200 dark:border-gray-700 hover:border-violet-400 dark:hover:border-violet-500 transition-colors text-gray-600 dark:text-gray-300 hover:text-violet-700 dark:hover:text-violet-300"
          >
            {copied ? <FiCheck className="w-3.5 h-3.5" /> : <FiCopy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          >
            <FiRefreshCw className="w-3.5 h-3.5" /> Analyze Another
          </button>
        </div>
      </div>

      {/* ── Overview cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Meeting Type',
            value: a.meetingType?.replace(/^\w/, (c) => c.toUpperCase()) ?? '—',
            sub:   null,
          },
          {
            label: 'Sentiment',
            value: a.sentiment?.overall
              ? a.sentiment.overall.charAt(0).toUpperCase() + a.sentiment.overall.slice(1)
              : '—',
            badge: { styleMap: SENTIMENT_STYLE, value: a.sentiment?.overall },
          },
          {
            label: 'Word Count',
            value: a.wordCount?.toLocaleString() ?? '—',
            sub:   a.estimatedDuration ?? null,
          },
          {
            label: 'Participants',
            value: a.participants?.length ?? '—',
            sub:   a.participants?.map((p) => p.name).join(', ') || null,
          },
        ].map((card) => (
          <div key={card.label} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-1">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{card.label}</p>
            {card.badge
              ? <Badge value={card.badge.value} styleMap={card.badge.styleMap} />
              : <p className="text-lg font-bold text-gray-900 dark:text-white">{card.value}</p>
            }
            {card.sub && (
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{card.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* ── Summary ───────────────────────────────────────────────────────── */}
      {a.summary && (
        <Section icon={FiMessageSquare} title="Executive Summary" copyText={a.summary}>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{a.summary}</p>
        </Section>
      )}

      {/* ── Action Items ──────────────────────────────────────────────────── */}
      {a.actionItems?.length > 0 && (
        <Section
          icon={FiTarget}
          title={`Action Items (${a.actionItems.length})`}
          copyText={a.actionItems.map((i) => `[ ] ${i.task} — ${i.assignee}${i.dueDate ? ` (${i.dueDate})` : ''}`).join('\n')}
        >
          <div className="space-y-2">
            {a.actionItems.map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <span className="w-5 h-5 rounded-md border-2 border-gray-300 dark:border-gray-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-white font-medium">{item.task}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {item.assignee && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        <FiUsers className="inline w-3 h-3 mr-1" />{item.assignee}
                      </span>
                    )}
                    {item.dueDate && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">Due: {item.dueDate}</span>
                    )}
                    {item.priority && (
                      <Badge value={item.priority} styleMap={PRIORITY_STYLE} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Key Topics ────────────────────────────────────────────────────── */}
      {a.keyTopics?.length > 0 && (
        <Section
          icon={FiList}
          title={`Key Topics (${a.keyTopics.length})`}
          copyText={a.keyTopics.map((t) => `${t.topic}: ${t.description}`).join('\n')}
        >
          <div className="space-y-2">
            {a.keyTopics.map((topic, idx) => (
              <div key={idx} className="flex gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{topic.topic}</p>
                  {topic.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{topic.description}</p>
                  )}
                </div>
                {topic.timeSpent && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{topic.timeSpent}</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Decisions ─────────────────────────────────────────────────────── */}
      {a.decisions?.length > 0 && (
        <Section
          icon={FiCheck}
          title={`Decisions (${a.decisions.length})`}
          copyText={a.decisions.map((d) => `- ${d.decision}${d.owner ? ` [${d.owner}]` : ''}`).join('\n')}
        >
          <div className="space-y-2">
            {a.decisions.map((d, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/10">
                <p className="text-sm text-gray-900 dark:text-white font-medium">{d.decision}</p>
                <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {d.owner      && <span>Owner: {d.owner}</span>}
                  {d.rationale  && <span>{d.rationale}</span>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Risks ─────────────────────────────────────────────────────────── */}
      {a.risks?.length > 0 && (
        <Section
          icon={FiAlertTriangle}
          title={`Risks (${a.risks.length})`}
          copyText={a.risks.map((r) => `[${r.severity}] ${r.risk}`).join('\n')}
          defaultOpen={false}
        >
          <div className="space-y-2">
            {a.risks.map((r, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                <Badge value={r.severity} styleMap={SEVERITY_STYLE} />
                <p className="text-sm text-gray-700 dark:text-gray-300">{r.risk}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Insights ──────────────────────────────────────────────────────── */}
      {a.insights?.length > 0 && (
        <Section
          icon={FiZap}
          title={`Insights (${a.insights.length})`}
          copyText={a.insights.join('\n')}
          defaultOpen={false}
        >
          <ul className="space-y-2">
            {a.insights.map((insight, idx) => (
              <li key={idx} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className="text-violet-500 dark:text-violet-400 shrink-0 mt-0.5">→</span>
                {insight}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Follow-up Questions ───────────────────────────────────────────── */}
      {a.followUpQuestions?.length > 0 && (
        <Section
          icon={FiMessageSquare}
          title={`Follow-up Questions (${a.followUpQuestions.length})`}
          copyText={a.followUpQuestions.join('\n')}
          defaultOpen={false}
        >
          <ul className="space-y-1.5">
            {a.followUpQuestions.map((q, idx) => (
              <li key={idx} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className="text-gray-400 shrink-0">{idx + 1}.</span>{q}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Transcript toggle ─────────────────────────────────────────────── */}
      {transcript && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setShowTranscript((v) => !v)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setShowTranscript((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-2.5">
              <FiFileText className="w-4 h-4 text-violet-500 dark:text-violet-400" />
              <span className="font-semibold text-sm text-gray-900 dark:text-white">Full Transcript</span>
            </div>
            <div className="flex items-center gap-1">
              <CopyButton text={transcript} size="sm" />
              {showTranscript
                ? <FiChevronUp   className="w-4 h-4 text-gray-400" />
                : <FiChevronDown className="w-4 h-4 text-gray-400" />
              }
            </div>
          </div>
          {showTranscript && (
            <div className="px-5 pb-5 pt-1">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                {transcript}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Raw JSON ──────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowRaw((v) => !v)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setShowRaw((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer select-none"
        >
          <div className="flex items-center gap-2.5">
            <FiCode className="w-4 h-4 text-violet-500 dark:text-violet-400" />
            <span className="font-semibold text-sm text-gray-900 dark:text-white">Raw JSON</span>
          </div>
          <div className="flex items-center gap-1">
            <CopyButton text={fullJson} size="sm" />
            {showRaw
              ? <FiChevronUp   className="w-4 h-4 text-gray-400" />
              : <FiChevronDown className="w-4 h-4 text-gray-400" />
            }
          </div>
        </div>
        {showRaw && (
          <div className="px-5 pb-5 pt-1">
            <JsonViewer data={a} />
          </div>
        )}
      </div>

      {/* ── Chat ──────────────────────────────────────────────────────────── */}
      {projectId && (
        <Section icon={FiCpu} title="Ask Claude About This Meeting" defaultOpen={true}>
          <ChatPanel projectId={projectId} initialMessages={initialMessages} />
        </Section>
      )}

    </div>
  )
}
