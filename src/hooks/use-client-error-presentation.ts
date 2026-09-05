"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  presentClientError,
  type ClientErrorPresentation,
} from "@/lib/client-error-presentation";

type ToastEmitter = (
  message: string,
  type: "error",
  persistent?: boolean,
  details?: string | null,
) => void;

export function useClientErrorPresentation() {
  const t = useTranslations("errors");

  const present = useCallback(
    (cause: unknown, fallbackMessage: string): ClientErrorPresentation =>
      presentClientError(cause, fallbackMessage, (key) => t(key)),
    [t],
  );

  const show = useCallback(
    (emit: ToastEmitter, cause: unknown, fallbackMessage: string) => {
      const presentation = present(cause, fallbackMessage);
      emit(
        presentation.message,
        "error",
        false,
        presentation.technicalReference,
      );
    },
    [present],
  );

  return { present, show };
}
