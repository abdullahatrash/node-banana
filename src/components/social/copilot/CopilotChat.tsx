"use client"

import { useCallback, useState, useSyncExternalStore } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai"
import Link from "next/link"
import { KeyRoundIcon, SendIcon, SparklesIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import { useWorkflowStore } from "@/store/workflowStore"
import { buildLlmHeaders } from "@/store/utils/buildApiHeaders"
import type { CopilotChannel } from "@/lib/social/copilot/channels"
import type { CopilotDraft } from "@/lib/social/copilot/drafts"
import type { CopilotReadiness } from "@/lib/social/copilot/validate"

// SSR-safe "are we on the client yet" signal via useSyncExternalStore:
// the server snapshot is false and the client snapshot is true, so the first
// (hydration) render matches the server, then React swaps to true — no effect.
const noopSubscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

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

/** Render created/fetched drafts as deep links into the composer. */
function DraftLinks({ drafts }: { drafts: CopilotDraft[] }) {
  if (drafts.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {drafts.map((d) => (
        <Link
          key={d.id}
          href={`/social/compose/${d.id}`}
          className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
        >
          {d.content ? `“${d.content.slice(0, 40)}${d.content.length > 40 ? "…" : ""}”` : "Draft"} · Open draft →
        </Link>
      ))}
    </div>
  )
}

/** Render per-channel publish readiness as a ready/blocked chip with reasons. */
function ReadinessChip({ readiness }: { readiness: CopilotReadiness }) {
  return (
    <div
      className={`rounded-md border px-2 py-1 text-xs ${
        readiness.ready
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      <span className="font-medium">
        {readiness.platform}: {readiness.ready ? "Ready to publish" : "Not ready"}
      </span>
      {!readiness.ready && readiness.reasons.length > 0 && (
        <ul className="mt-1 list-disc ps-4">
          {readiness.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CopilotChat() {
  const providerSettings = useWorkflowStore((s) => s.providerSettings)
  const updateProviderApiKey = useWorkflowStore((s) => s.updateProviderApiKey)
  const anthropicKey = providerSettings.providers.anthropic?.apiKey ?? ""
  const [keyInput, setKeyInput] = useState("")
  const [showKeyEntry, setShowKeyEntry] = useState(false)
  const [input, setInput] = useState("")

  // providerSettings is hydrated from localStorage, which is empty during SSR.
  // Gate key-dependent UI until the client takes over so renders agree.
  const hydrated = useSyncExternalStore(noopSubscribe, getClientSnapshot, getServerSnapshot)
  const hasKey = hydrated && Boolean(anthropicKey)

  // Inject the user's BYOK key on every request (read fresh from the store).
  const buildHeaders = useCallback(
    () => buildLlmHeaders("anthropic", useWorkflowStore.getState().providerSettings),
    [],
  )
  const customFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      for (const [k, v] of Object.entries(buildHeaders())) headers.set(k, v)
      return fetch(input, { ...init, headers })
    },
    [buildHeaders],
  )

  const [transport] = useState(
    () => new DefaultChatTransport({ api: "/api/social/copilot", fetch: customFetch }),
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { messages, sendMessage, status, stop, addToolApprovalResponse } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => {
      setErrorMessage(error.message)
      if (/x-api-key|api[- ]?key|unauthor|authentication|invalid.*key|\b401\b/i.test(error.message)) {
        setShowKeyEntry(true)
      }
    },
  })

  const isLoading = status === "streaming" || status === "submitted"

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setErrorMessage(null)
    sendMessage({ text })
    setInput("")
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">Copilot</span>
        {hasKey && (
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

      {hydrated && (!hasKey || showKeyEntry) && (
        <div className="m-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            {hasKey ? "Update your Anthropic API key" : "Add your Anthropic API key"}
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
            {hasKey && (
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

      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <div className="mx-auto max-w-md pt-10 text-center">
              <SparklesIcon className="mx-auto mb-3 size-6 text-muted-foreground" />
              <h2 className="text-sm font-medium">Social Copilot</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask me about your connected channels to get started — e.g. “What channels can I post to?”
              </p>
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

            const readinessParts = message.parts?.filter(
              (p) =>
                p.type === "tool-validatePublish" &&
                "state" in p &&
                p.state === "output-available",
            ) ?? []

            const approvalParts = message.parts?.filter(
              (p) =>
                (p.type === "tool-scheduleDraft" || p.type === "tool-publishNow") &&
                "state" in p &&
                p.state === "approval-requested",
            ) ?? []

            const commitResultParts = message.parts?.filter(
              (p) =>
                (p.type === "tool-scheduleDraft" || p.type === "tool-publishNow") &&
                "state" in p &&
                p.state === "output-available",
            ) ?? []

            const draftParts = message.parts?.filter(
              (p) =>
                (p.type === "tool-createDraft" ||
                  p.type === "tool-listDrafts" ||
                  p.type === "tool-getDraft" ||
                  p.type === "tool-updateDraft" ||
                  p.type === "tool-duplicateDraft") &&
                "state" in p &&
                p.state === "output-available",
            ) ?? []

            return (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {channelParts.map((p, i) => {
                    const output = (p as { output?: { channels?: CopilotChannel[] } }).output
                    return <ChannelsToolOutput key={i} channels={output?.channels ?? []} />
                  })}
                  {draftParts.map((p, i) => {
                    const output = (p as {
                      output?: { drafts?: CopilotDraft[]; draft?: CopilotDraft }
                    }).output
                    const drafts = output?.drafts ?? (output?.draft ? [output.draft] : [])
                    return <DraftLinks key={`d${i}`} drafts={drafts} />
                  })}
                  {readinessParts.map((p, i) => {
                    const output = (p as { output?: { readiness?: CopilotReadiness } }).output
                    return output?.readiness ? (
                      <ReadinessChip key={`r${i}`} readiness={output.readiness} />
                    ) : null
                  })}
                  {approvalParts.map((p, i) => {
                    const action = p.type === "tool-scheduleDraft" ? "Schedule this post" : "Publish this post now"
                    const input = (p as { input?: { scheduledAt?: string } }).input
                    const approvalId = (p as { approval?: { id?: string } }).approval?.id
                    return (
                      <div
                        key={`ap${i}`}
                        className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                      >
                        <p className="font-medium">{action}?</p>
                        {input?.scheduledAt && (
                          <p className="text-muted-foreground">
                            At {new Date(input.scheduledAt).toLocaleString()}
                          </p>
                        )}
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            disabled={!approvalId}
                            onClick={() =>
                              approvalId && addToolApprovalResponse({ id: approvalId, approved: true })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!approvalId}
                            onClick={() =>
                              approvalId && addToolApprovalResponse({ id: approvalId, approved: false })
                            }
                          >
                            Deny
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                  {commitResultParts.map((p, i) => {
                    const out = (p as { output?: { scheduledAt?: string | null } }).output
                    return (
                      <div
                        key={`cr${i}`}
                        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs"
                      >
                        {out?.scheduledAt
                          ? `Scheduled for ${new Date(out.scheduledAt).toLocaleString()}`
                          : "Queued to publish now"}
                      </div>
                    )
                  })}
                  {text &&
                    (message.role === "assistant" ? (
                      <MessageResponse>{text}</MessageResponse>
                    ) : (
                      <span className="whitespace-pre-wrap">{text}</span>
                    ))}
                </MessageContent>
              </Message>
            )
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {errorMessage && (
        <div className="border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the copilot…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {isLoading ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => stop()}>
            <SquareIcon className="size-4" />
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={!input.trim()}>
            <SendIcon className="size-4" />
          </Button>
        )}
      </form>
    </div>
  )
}
