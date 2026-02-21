/**
 * ChatPanel — streaming per-project chat with Claude.
 *
 * Props:
 *   projectId       — string UUID
 *   initialMessages — array of { role, content, ts }
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { FiSend, FiLoader, FiUser, FiCpu, FiAlertCircle } from 'react-icons/fi'

function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function MessageBubble({ msg, isStreaming }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
        isUser
          ? 'bg-gradient-to-br from-violet-500 to-indigo-600'
          : 'bg-gradient-to-br from-gray-600 to-gray-800 dark:from-gray-500 dark:to-gray-700'
      }`}>
        {isUser ? <FiUser className="w-4 h-4" /> : <FiCpu className="w-4 h-4" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-tr-sm'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-tl-sm'
      }`}>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-current opacity-70 animate-pulse rounded-sm" />
        )}
        {msg.ts && !isStreaming && (
          <p className={`text-xs mt-1.5 ${isUser ? 'text-violet-200' : 'text-gray-400 dark:text-gray-500'}`}>
            {formatTime(msg.ts)}
          </p>
        )}
      </div>
    </div>
  )
}

export default function ChatPanel({ projectId, initialMessages = [] }) {
  const [messages,      setMessages]      = useState(initialMessages)
  const [input,         setInput]         = useState('')
  const [streaming,     setStreaming]      = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error,         setError]         = useState(null)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)
  const abortRef   = useRef(null) // AbortController for in-flight request

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    setInput('')
    setError(null)

    const userMsg = { role: 'user', content: text, ts: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    setStreaming(true)
    setStreamingText('')

    abortRef.current = new AbortController()

    try {
      const res = await fetch(`/api/chat/${projectId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text }),
        signal:  abortRef.current.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Chat failed (${res.status})`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''
      let   full    = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === 'delta') {
            full += event.text
            setStreamingText(full)
          } else if (event.type === 'done') {
            // Server confirmed full text
          } else if (event.type === 'error') {
            throw new Error(event.error || 'Chat failed')
          }
        }
      }

      // Commit the streamed response as a real message
      const assistantMsg = { role: 'assistant', content: full, ts: new Date().toISOString() }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
        // Remove the optimistic user message on error
        setMessages((prev) => prev.filter((m) => m !== userMsg))
      }
    } finally {
      setStreaming(false)
      setStreamingText('')
      abortRef.current = null
      inputRef.current?.focus()
    }
  }, [input, streaming, projectId])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const allMessages = streaming
    ? [...messages, { role: 'assistant', content: streamingText, ts: null }]
    : messages

  return (
    <div className="flex flex-col h-[480px]">

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4">
        {allMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
              <FiCpu className="w-6 h-6 text-gray-400 dark:text-gray-600" />
            </div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Ask anything about this meeting</p>
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-1 max-w-xs">
              Clarify decisions, expand on action items, explore what was discussed…
            </p>
          </div>
        )}

        {allMessages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            isStreaming={streaming && i === allMessages.length - 1 && msg.role === 'assistant'}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-xs">
          <FiAlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto underline">Dismiss</button>
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          placeholder="Ask a question… (Enter to send, Shift+Enter for new line)"
          rows={2}
          className="flex-1 resize-none px-4 py-3 rounded-xl text-sm bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-600 text-gray-900 dark:text-gray-100 transition-colors disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || streaming}
          aria-label="Send message"
          className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-500/20 active:scale-95"
        >
          {streaming
            ? <FiLoader className="w-4 h-4 animate-spin" />
            : <FiSend className="w-4 h-4" />
          }
        </button>
      </div>
    </div>
  )
}
