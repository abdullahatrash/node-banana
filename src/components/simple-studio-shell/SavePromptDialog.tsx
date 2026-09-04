"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";
import { useTranslations } from "next-intl";

export function SavePromptDialog() {
  const t = useTranslations("studioUi.savePrompt");
  const open = useSimpleStudioShellStore((s) => s.savePromptDialogOpen);
  const closeDialog = useSimpleStudioShellStore((s) => s.closeSavePromptDialog);
  const storePrompt = useSimpleStudioStore((s) => s.prompt);
  const mode = useSimpleStudioStore((s) => s.mode);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const saveCurrentPrompt = useSimpleStudioStore((s) => s.saveCurrentPrompt);

  const [name, setName] = useState("");
  const [promptText, setPromptText] = useState(storePrompt);
  const [saving, setSaving] = useState(false);

  // Re-seed the dialog's local prompt from the store whenever the dialog opens
  useEffect(() => {
    if (open) {
      setPromptText(storePrompt);
      setName("");
    }
  }, [open, storePrompt]);

  const disabled =
    saving || name.trim().length === 0 || promptText.trim().length === 0;

  const handleSave = async () => {
    if (disabled) return;
    setSaving(true);
    try {
      // If the user edited the prompt in the dialog, push it to the store
      // so saveCurrentPrompt picks it up.
      if (promptText !== storePrompt) {
        setPrompt(promptText);
      }
      await saveCurrentPrompt(name.trim());
      closeDialog();
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) closeDialog();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { mode: t(`mode.${mode}`) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="save-prompt-name" className="mb-1 block text-sm font-medium">
              {t("name")}
            </label>
            <input
              id="save-prompt-name"
              type="text"
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder={t("namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="save-prompt-text"
              className="mb-1 block text-sm font-medium"
            >
              {t("promptText")}
            </label>
            <textarea
              id="save-prompt-text"
              className="max-h-48 min-h-24 w-full resize-y rounded-md border bg-background p-2 text-sm"
              placeholder={t("promptPlaceholder")}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={disabled}>
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
