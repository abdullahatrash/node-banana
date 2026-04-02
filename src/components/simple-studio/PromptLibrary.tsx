"use client";

import { useEffect, useState } from "react";
import { useSimpleStudioStore, type SavedPrompt } from "@/store/simpleStudioStore";
import { PROMPT_TEMPLATES } from "@/lib/simple-studio/promptTemplates";

type Tab = "templates" | "my-prompts";

export function PromptLibrary() {
  const [activeTab, setActiveTab] = useState<Tab>("templates");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const mode = useSimpleStudioStore((s) => s.mode);
  const prompt = useSimpleStudioStore((s) => s.prompt);
  const savedPrompts = useSimpleStudioStore((s) => s.savedPrompts);
  const applyPrompt = useSimpleStudioStore((s) => s.applyPrompt);
  const saveCurrentPrompt = useSimpleStudioStore((s) => s.saveCurrentPrompt);
  const loadSavedPrompts = useSimpleStudioStore((s) => s.loadSavedPrompts);

  // Load saved prompts once on mount (silently fails if DB not migrated)
  useEffect(() => {
    loadSavedPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter templates by current mode
  const filteredTemplates = PROMPT_TEMPLATES.filter((t) => t.mode === mode);

  const handleSave = async () => {
    if (!saveName.trim()) return;
    await saveCurrentPrompt(saveName.trim());
    setSaveName("");
    setSaveDialogOpen(false);
  };

  return (
    <div className="border-t border-neutral-800">
      {/* Tabs + save button */}
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex gap-3">
          <button
            onClick={() => setActiveTab("templates")}
            className={`text-xs font-medium pb-1 transition-colors ${
              activeTab === "templates"
                ? "text-neutral-200 border-b border-blue-500"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Templates
          </button>
          <button
            onClick={() => setActiveTab("my-prompts")}
            className={`text-xs font-medium pb-1 transition-colors ${
              activeTab === "my-prompts"
                ? "text-neutral-200 border-b border-blue-500"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            My Prompts
          </button>
        </div>
        {prompt.trim() && (
          <button
            onClick={() => setSaveDialogOpen(true)}
            className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            Save Prompt
          </button>
        )}
      </div>

      {/* Save dialog */}
      {saveDialogOpen && (
        <div className="px-4 py-2">
          <div className="flex gap-2">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Prompt name..."
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
            <button
              onClick={handleSave}
              disabled={!saveName.trim()}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:opacity-40 hover:bg-blue-500 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setSaveDialogOpen(false)}
              className="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Prompt list */}
      <div className="px-4 py-2 space-y-1.5 max-h-[200px] overflow-y-auto">
        {activeTab === "templates" && (
          <>
            {filteredTemplates.length === 0 ? (
              <p className="text-xs text-neutral-600 py-2">No templates for this mode</p>
            ) : (
              filteredTemplates.map((tpl) => (
                <PromptItem key={tpl.id} prompt={tpl} onApply={applyPrompt} />
              ))
            )}
          </>
        )}

        {activeTab === "my-prompts" && (
          <>
            {savedPrompts.length === 0 ? (
              <p className="text-xs text-neutral-600 py-2">No saved prompts yet</p>
            ) : (
              savedPrompts.map((p) => (
                <PromptItem key={p.id} prompt={p} onApply={applyPrompt} />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PromptItem({
  prompt,
  onApply,
}: {
  prompt: SavedPrompt;
  onApply: (p: SavedPrompt) => void;
}) {
  return (
    <button
      onClick={() => onApply(prompt)}
      className="w-full text-start p-2 rounded hover:bg-neutral-800/50 transition-colors group"
    >
      <div className="text-xs font-medium text-neutral-300 group-hover:text-neutral-100 truncate" dir="auto">
        {prompt.name}
      </div>
      <div className="text-[10px] text-neutral-500 mt-0.5 line-clamp-2" dir="auto">
        {prompt.promptText}
      </div>
    </button>
  );
}
