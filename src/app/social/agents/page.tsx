"use client"

import { useCallback, useEffect, useState } from "react"
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
import { useFormatter, useTranslations } from "next-intl"
import { useClientErrorPresentation } from "@/hooks/use-client-error-presentation"

export default function SocialAgentsPage() {
  const t = useTranslations("social.agents")
  const format = useFormatter()
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
  const [error, setError] = useState<string | null>(null)
  const { show } = useToast()
  const { present: presentClientError, show: showClientError } = useClientErrorPresentation()

  const load = useCallback(async () => {
    setError(null)
    try {
      const [loadedRules, loadedTasks, loadedPrefs] = await Promise.all([
        listAutomationRules(),
        listAutomationTasks(),
        getSocialNotificationPreferences(),
      ])
      setRules(loadedRules)
      setTasks(loadedTasks)
      setPrefs(loadedPrefs)
    } catch (error) {
      const message = presentClientError(error, t("errors.load")).message
      setError(message)
      setRules([])
      setTasks([])
      setPrefs(null)
    } finally {
      setIsLoading(false)
    }
  }, [presentClientError, t])

  useEffect(() => {
    load()
  }, [load])

  async function toggleMuteAll() {
    if (!prefs) return
    setIsSaving(true)
    try {
      const updated = await updateSocialNotificationPreferences({
        muteAll: !prefs.muteAll,
      })
      setPrefs(updated)
      show(updated.muteAll ? t("toast.muted") : t("toast.notificationsEnabled"), "success")
    } catch (error) {
      showClientError(show, error, t("errors.preferences"))
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleRule(rule: AutomationRule) {
    setBusyId(rule.id)
    try {
      await updateAutomationRule(rule.id, { enabled: !rule.enabled })
      await load()
      show(rule.enabled ? t("toast.ruleDisabled") : t("toast.ruleEnabled"), "success")
    } catch (error) {
      showClientError(show, error, t("errors.updateRule"))
    } finally {
      setBusyId(null)
    }
  }

  async function removeRule(ruleId: string) {
    if (!confirm(t("confirmDeleteRule"))) return
    setBusyId(ruleId)
    try {
      await deleteAutomationRule(ruleId)
      await load()
      show(t("toast.ruleDeleted"), "success")
    } catch (error) {
      showClientError(show, error, t("errors.deleteRule"))
    } finally {
      setBusyId(null)
    }
  }

  async function cancelTask(taskId: string) {
    setBusyId(taskId)
    try {
      await updateAutomationTask(taskId, { state: "cancelled" })
      await load()
      show(t("toast.taskCancelled"), "success")
    } catch (error) {
      showClientError(show, error, t("errors.cancelTask"))
    } finally {
      setBusyId(null)
    }
  }

  async function removeTask(taskId: string) {
    if (!confirm(t("confirmDeleteTask"))) return
    setBusyId(taskId)
    try {
      await deleteAutomationTask(taskId)
      await load()
      show(t("toast.taskDeleted"), "success")
    } catch (error) {
      showClientError(show, error, t("errors.deleteTask"))
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
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("ruleCount")}</div>
          <div className="mt-1 text-2xl font-semibold"><bdi>{format.number(rules.length)}</bdi></div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("taskCount")}</div>
          <div className="mt-1 text-2xl font-semibold"><bdi>{format.number(tasks.length)}</bdi></div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("notifications")}</div>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={toggleMuteAll} disabled={isSaving}>
              {prefs?.muteAll ? t("unmuteAll") : t("muteAll")}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium">{t("rules")}</h3>
        {rules.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("emptyRules")}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">{rule.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {rule.enabled ? t("state.enabled") : t("state.disabled")} · <bdi>{rule.triggerSource}</bdi>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleRule(rule)}
                    disabled={busyId === rule.id}
                  >
                    {rule.enabled ? t("disable") : t("enable")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeRule(rule.id)}
                    disabled={busyId === rule.id}
                  >
                    {t("delete")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("tasks")}</h3>
          {tasks.length > 40 && (
            <span className="text-xs text-muted-foreground">
              {t("showing", { shown: 40, total: tasks.length })}
            </span>
          )}
        </div>
        {tasks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("emptyTasks")}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {tasks.slice(0, 40).map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">{task.taskKey}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {t(`taskState.${task.state}`)} · {t("run", { index: task.runIndex })}
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
                      {t("cancel")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeTask(task.id)}
                    disabled={busyId === task.id}
                  >
                    {t("delete")}
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
