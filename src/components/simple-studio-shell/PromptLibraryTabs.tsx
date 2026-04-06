"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  useSimpleStudioStore,
  type SavedPrompt,
} from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";
import { MODE_TO_URL_SEGMENT } from "./urlToMode";

function PromptCard({
  prompt,
  onUse,
}: {
  prompt: SavedPrompt;
  onUse: (p: SavedPrompt) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm">{prompt.name}</div>
        <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">
          {prompt.mode}
        </span>
      </div>
      <div className="text-xs text-muted-foreground line-clamp-3">
        {prompt.promptText}
      </div>
      <div className="pt-2">
        <Button size="sm" onClick={() => onUse(prompt)}>
          Use
        </Button>
      </div>
    </div>
  );
}

export function PromptLibraryTabs() {
  const router = useRouter();
  const tab = useSimpleStudioShellStore((s) => s.promptLibraryTab);
  const setTab = useSimpleStudioShellStore((s) => s.setPromptLibraryTab);

  const savedPrompts = useSimpleStudioStore((s) => s.savedPrompts);
  const publicPrompts = useSimpleStudioStore((s) => s.publicPrompts);
  const loadSavedPrompts = useSimpleStudioStore((s) => s.loadSavedPrompts);
  const loadPublicPrompts = useSimpleStudioStore((s) => s.loadPublicPrompts);
  const applyPrompt = useSimpleStudioStore((s) => s.applyPrompt);

  useEffect(() => {
    void loadSavedPrompts();
    void loadPublicPrompts();
  }, [loadSavedPrompts, loadPublicPrompts]);

  const handleUse = (prompt: SavedPrompt) => {
    applyPrompt(prompt);
    router.push(`/simple-studio/${MODE_TO_URL_SEGMENT[prompt.mode]}`);
  };

  return (
    <div className="p-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "templates" | "saved")}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="saved">Saved</TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          {publicPrompts.length === 0 ? (
            <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
              No templates yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {publicPrompts.map((p) => (
                <PromptCard key={p.id} prompt={p} onUse={handleUse} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="saved">
          {savedPrompts.length === 0 ? (
            <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
              No saved prompts yet. Save one from any creation page.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {savedPrompts.map((p) => (
                <PromptCard key={p.id} prompt={p} onUse={handleUse} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
