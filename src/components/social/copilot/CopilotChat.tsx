"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import ReactMarkdown from "react-markdown"
import Link from "next/link"
import { KeyRoundIcon, Loader2Icon, SendIcon, SparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/store/workflowStore"
import { buildLlmHeaders } from "@/store/utils/buildApiHeaders"
import type { CopilotChannel } from "@/lib/social/copilot/channels"

/**
 * Render the output of the listChannels tool as a compact channel summary.
 * Richer, per-platform generative UI arrives in a later slice.
 */
function ChannelsToolOutput({ channels }: { channels: CopilotChannel[] }) {
  if (channels.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No connected channels yet.{" "}
        <Link href="/social/channels" className="underline">
          Connect one
        </Link>
        .
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]"
          title={`${c.capabilities.maxContentLength} chars · ${c.capabilities.supportsImages ? "images" : "no images"}`}
        >
          {c.displayName}
          {c.disabled && <span className="text-destructive">· disabled</span>}
          {c.requiresReauth && <span className="text-amber-600">· reconnect</span>}
        </span>
      ))}
    </div>
  )
}

export function CopilotChat() {
  const providerSettings = useWorkflowStore((s) => s.providerSettings)
  const updateProviderApiKey = useWorkflowStore((s) => s.updateProviderApiKey)
  const anthropicKey = providerSettings.providers.anthropic?.apiKey ?? ""
  const [keyInput, setKeyInput] = useState("")
  const [showKeyEntry, setShowKeyEntry] = useState(false)

  const headersRef = useRef<Record<string, string>>({})
  headersRef.current = buildLlmHeaders("anthropic", providerSettings)

  const customFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      for (const [k, v] of Object.entries(headersRef.current)) headers.set(k, v)
      return fetch(input, { ...init, headers })
    },
    [],
  )

  const [transport] = useState(
    () => new DefaultChatTransport({ api: "/api/social/copilot", fetch: customFetch }),
  )
  const [input, setInput] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status } = useChat({
    transport,
    onError: (error) => {
      setErrorMessage(error.message)
      // Anthropic rejected the key — resurface the key field so it can be fixed.
      if (/x-api-key|api[- ]?key|unauthor|authentication|invalid.*key|\b401\b/i.test(error.message)) {
        setShowKeyEntry(true)
      }
    },
  })

  const isLoading = status === "streaming" || status === "submitted"

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">Copilot</span>
        {anthropicKey && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowKeyEntry((v) => !v)}
          >
            <KeyRoundIcon className="mr-1 size-3.5" />
            API key
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md pt-10 text-center">
            <SparklesIcon className="mx-auto mb-3 size-6 text-muted-foreground" />
            <h2 className="text-sm font-medium">Social Copilot</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask me about your connected channels to get started — e.g. “What channels can I post to?”
            </p>
          </div>
        )}

        {(!anthropicKey || showKeyEntry) && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">
              {anthropicKey ? "Update your Anthropic API key" : "Add your Anthropic API key"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The copilot runs on your own key (starts with <code>sk-ant-</code>). It’s stored locally in this browser and only sent to call the model.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const value = keyInput.trim()
                if (!value) return
                updateProviderApiKey("anthropic", value)
                setKeyInput("")
                setShowKeyEntry(false)
                setErrorMessage(null)
              }}
              className="mt-2 flex gap-2"
            >
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="submit" size="sm" disabled={!keyInput.trim()}>
                Save key
              </Button>
              {anthropicKey && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowKeyEntry(false)
                    setKeyInput("")
                  }}
                >
                  Cancel
                </Button>
              )}
            </form>
          </div>
        )}

        {messages.map((message) => {
          const text = message.parts
            ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("") ?? ""

          const channelParts = message.parts?.filter(
            (p) =>
              p.type === "tool-listChannels" &&
              "state" in p &&
              p.state === "output-available",
          ) ?? []

          return (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border bg-card"
                }`}
              >
                {channelParts.map((p, i) => {
                  const output = (p as { output?: { channels?: CopilotChannel[] } }).output
                  return (
                    <div key={i} className="mb-2">
                      <ChannelsToolOutput channels={output?.channels ?? []} />
                    </div>
                  )
                })}
                {text &&
                  (message.role === "user" ? (
                    <p className="whitespace-pre-wrap">{text}</p>
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown>{text}</ReactMarkdown>
                    </div>
                  ))}
              </div>
            </div>
          )
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-lg border bg-card px-3 py-2">
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {errorMessage && (
        <div className="border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (input.trim() && !isLoading) {
            setErrorMessage(null)
            sendMessage({ text: input })
            setInput("")
          }
        }}
        className="flex items-center gap-2 border-t p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the copilot…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" size="sm" disabled={!input.trim() || isLoading}>
          <SendIcon className="size-4" />
        </Button>
      </form>
    </div>
  )
}
