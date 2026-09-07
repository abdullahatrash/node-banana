"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  compositionSchema,
  emptyComposition,
  type Composition,
  type EditorRecord,
} from "@/lib/video-editor/composition";
import { EditorApiError, type EditorClient } from "@/lib/video-editor/api";
import { errorCopy, type EditorCopy } from "./copy";
type Attempt = {
  composition: Composition;
  base: EditorRecord | null;
  key: string;
};
function compositionKey(value: Composition) {
  const canonical = compositionSchema.safeParse(value);
  return JSON.stringify(canonical.success ? canonical.data : value);
}
function showDraftUrl(id: string) {
  const url = new URL(window.location.href);
  url.pathname = "/editor";
  url.searchParams.set("piece", id);
  window.history.replaceState(null, "", url);
}
function editGroup(before: Composition, after: Composition) {
  return Object.keys(after)
    .filter(
      (key) =>
        JSON.stringify(before[key as keyof Composition]) !==
        JSON.stringify(after[key as keyof Composition]),
    )
    .map((key) => {
      const value = after[key as keyof Composition],
        prior = before[key as keyof Composition];
      return value &&
        prior &&
        typeof value === "object" &&
        typeof prior === "object"
        ? `${key}:${Object.keys(value)
            .filter(
              (field) =>
                JSON.stringify(Reflect.get(value, field)) !==
                JSON.stringify(Reflect.get(prior, field)),
            )
            .join(",")}`
        : key;
    })
    .join("|");
}
export function useEditorDraft(api: EditorClient, copy: EditorCopy) {
  const [composition, render] = useState(() => emptyComposition(copy.untitled));
  const [current, setCurrent] = useState<EditorRecord | null>(null),
    [status, setStatus] = useState("");
  const [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const [records, setRecords] = useState<EditorRecord[]>([]),
    [historyVersion, setHistoryVersion] = useState(0);
  const latest = useRef(composition),
    record = useRef(current),
    saved = useRef(compositionKey(composition));
  const past = useRef<Composition[]>([]),
    future = useRef<Composition[]>([]),
    group = useRef({ key: "", at: 0 });
  const gesture = useRef({ active: false, changed: false });
  const onGesture = useCallback((active: boolean) => {
    gesture.current = { active, changed: false };
    group.current.key = "";
  }, []);
  const pending = useRef<Attempt | null>(null),
    inFlight = useRef<Promise<boolean> | null>(null),
    blocked = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const show = useCallback(
    (next: Composition) => {
      latest.current = next;
      render(next);
      setStatus(
        inFlight.current
          ? copy.saving
          : compositionKey(next) === saved.current
            ? copy.saved
            : copy.unsaved,
      );
    },
    [copy],
  );
  const change = useCallback(
    (
      update: Composition | ((value: Composition) => Composition),
      atomic = false,
    ) => {
      const next =
        typeof update === "function" ? update(latest.current) : update;
      if (JSON.stringify(next) === JSON.stringify(latest.current)) return;
      const key = editGroup(latest.current, next),
        now = performance.now();
      if (
        gesture.current.active
          ? !gesture.current.changed
          : atomic || key !== group.current.key || now - group.current.at > 600
      )
        past.current = [...past.current.slice(-99), latest.current];
      if (gesture.current.active) gesture.current.changed = true;
      group.current = { key: atomic ? "" : key, at: now };
      future.current = [];
      show(next);
      setHistoryVersion((value) => value + 1);
    },
    [show],
  );
  const undo = () => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(latest.current);
    group.current.key = "";
    show(previous);
    setHistoryVersion((value) => value + 1);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(latest.current);
    group.current.key = "";
    show(next);
    setHistoryVersion((value) => value + 1);
  };
  const adopt = useCallback(
    (next: EditorRecord, retainUndo = false) => {
      past.current = retainUndo
        ? [...past.current.slice(-99), latest.current]
        : [];
      future.current = [];
      group.current.key = "";
      record.current = next;
      showDraftUrl(next.id);
      setCurrent(next);
      saved.current = compositionKey(next.composition);
      pending.current = null;
      blocked.current = false;
      setConflict(false);
      setError("");
      show(next.composition);
      setHistoryVersion((value) => value + 1);
    },
    [show],
  );
  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (blocked.current) return Promise.resolve(false);
    if (
      !latest.current.main ||
      (compositionKey(latest.current) === saved.current && !pending.current)
    )
      return Promise.resolve(true);
    if (!pending.current) {
      const parsed = compositionSchema.safeParse(latest.current);
      if (!parsed.success) {
        setError(copy.errors.EDITOR_COMPOSITION_INVALID);
        setStatus(copy.unsaved);
        return Promise.resolve(false);
      }
      pending.current = {
        composition: parsed.data,
        base: record.current,
        key: crypto.randomUUID(),
      };
    }
    setStatus(copy.saving);
    group.current.key = "";
    const run = async () => {
      // One attempt retains its exact revision and idempotency key after uncertain responses.
      while (pending.current) {
        const attempt = pending.current;
        try {
          const next = await api.saveComposition(
            attempt.composition,
            attempt.base,
            attempt.key,
          );
          record.current = next;
          saved.current = compositionKey(attempt.composition);
          pending.current = null;
          if (!mounted.current) return true;
          setCurrent(next);
          setRecords((items) => [
            next,
            ...items.filter((item) => item.id !== next.id),
          ]);
          setError("");
          showDraftUrl(next.id);
          if (compositionKey(latest.current) === saved.current) {
            setStatus(copy.saved);
            return true;
          }
          const parsed = compositionSchema.safeParse(latest.current);
          if (!parsed.success) {
            setStatus(copy.unsaved);
            return false;
          }
          pending.current = {
            composition: parsed.data,
            base: next,
            key: crypto.randomUUID(),
          };
        } catch (failure) {
          if (
            failure instanceof EditorApiError &&
            failure.status >= 400 &&
            failure.status < 500
          )
            pending.current = null;
          if (failure instanceof EditorApiError && failure.status === 409) {
            blocked.current = true;
            setConflict(true);
          }
          if (mounted.current) {
            setStatus(copy.unsaved);
            setError(errorCopy(failure, copy));
          }
          return false;
        }
      }
      return true;
    };
    const promise = run().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = promise;
    return promise;
  }, [api, copy]);
  const saveCopy = async () => {
    if (inFlight.current) await inFlight.current;
    record.current = null;
    setCurrent(null);
    saved.current = "";
    pending.current = null;
    blocked.current = false;
    setConflict(false);
    return save();
  };
  useEffect(() => {
    if (
      !composition.main ||
      compositionKey(composition) === saved.current ||
      blocked.current
    )
      return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
  }, [composition, save]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (
        latest.current.main &&
        compositionKey(latest.current) !== saved.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  return {
    composition,
    change,
    onGesture,
    current,
    status,
    error,
    setError,
    conflict,
    records,
    setRecords,
    adopt,
    save,
    saveCopy,
    undo,
    redo,
    canUndo: historyVersion >= 0 && past.current.length > 0,
    canRedo: historyVersion >= 0 && future.current.length > 0,
  };
}
