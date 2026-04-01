"use client"

import { useRef, useState } from "react"
import {
  deleteAutomationRule,
  deleteAutomationTask,
  getSocialNotificationPreferences,
  listAutomationRules,
  listAutomationTasks,
  type AutomationRule,
  type AutomationTask,
  updateAutomationRule,
  updateAutomationTask,
  updateSocialNotificationPreferences,
} from "@/lib/social/client"
import { useToast } from "@/components/Toast"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function SocialAgentsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [tasks, setTasks] = useState<AutomationTask[]>([])
  const [prefs, setPrefs] = useState<{
    inAppEnabled: boolean;
    emailEnabled: boolean;
    webhookEnabled: boolean;
    muteAll: boolean;
    preferences: Record<string, unknown> | null;
  } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const initialized = useRef(false)
  const { show } = useToast()

  async function load() {
    const [loadedRules, loadedTasks, loadedPrefs] = await Promise.all([
      listAutomationRules(),
      listAutomationTasks(),
      getSocialNotificationPreferences(),
    ])
    setRules(loadedRules)
    setTasks(loadedTasks)
    setPrefs(loadedPrefs)
  }

  if (!initialized.current) {
    initialized.current = true
    load().finally(() => setIsLoading(false))
  }

  async function toggleMuteAll() {
    if (!prefs) return
    setIsSaving(true)
    try {
      const updated = await updateSocialNotificationPreferences({
        muteAll: !prefs.muteAll,
      })
      setPrefs(updated)
      show(updated.muteAll ? "Notifications muted" : "Notifications enabled", "success")
    } catch (error) {
      show(error instanceof Error ? error.message : "Failed to update preferences", "error")
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleRule(rule: AutomationRule) {
    setBusyId(rule.id)
    try {
      await updateAutomationRule(rule.id, { enabled: !rule.enabled })
      await load()
      show(rule.enabled ? "Rule disabled" : "Rule enabled", "success")
    } catch (error) {
      show(error instanceof Error ? error.message : "Failed to update rule", "error")
    } finally {
      setBusyId(null)
    }
  }

  async function removeRule(ruleId: string) {
    if (!confirm("Delete this automation rule?")) return
    setBusyId(ruleId)
    try {
      await deleteAutomationRule(ruleId)
      await load()
      show("Rule deleted", "success")
    } catch (error) {
      show(error instanceof Error ? error.message : "Failed to delete rule", "error")
    } finally {
      setBusyId(null)
    }
  }

  async function cancelTask(taskId: string) {
    setBusyId(taskId)
    try {
      await updateAutomationTask(taskId, { state: "cancelled" })
      await load()
      show("Task cancelled", "success")
    } catch (error) {
      show(error instanceof Error ? error.message : "Failed to cancel task", "error")
    } finally {
      setBusyId(null)
    }
  }

  async function removeTask(taskId: string) {
    if (!confirm("Delete this automation task?")) return
    setBusyId(taskId)
    try {
      await deleteAutomationTask(taskId)
      await load()
      show("Task deleted", "success")
    } catch (error) {
      show(error instanceof Error ? error.message : "Failed to delete task", "error")
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <h2 className="text-lg font-semibold">Agents & Automation</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Automation rules</div>
          <div className="mt-1 text-2xl font-semibold">{rules.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Automation tasks</div>
          <div className="mt-1 text-2xl font-semibold">{tasks.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Notifications</div>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={toggleMuteAll} disabled={isSaving}>
              {prefs?.muteAll ? "Unmute all" : "Mute all"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium">Rules</h3>
        {rules.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No automation rules found.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">{rule.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {rule.enabled ? "Enabled" : "Disabled"} · {rule.triggerSource}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleRule(rule)}
                    disabled={busyId === rule.id}
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeRule(rule.id)}
                    disabled={busyId === rule.id}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Tasks</h3>
          {tasks.length > 40 && (
            <span className="text-xs text-muted-foreground">
              Showing 40 of {tasks.length}
            </span>
          )}
        </div>
        {tasks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No automation tasks found.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {tasks.slice(0, 40).map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">{task.taskKey}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {task.state} · run {task.runIndex}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(task.state === "pending" || task.state === "claimed") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelTask(task.id)}
                      disabled={busyId === task.id}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeTask(task.id)}
                    disabled={busyId === task.id}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
