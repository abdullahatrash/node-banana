"use client";

import Script from "next/script";
import { useRef, useState } from "react";

type PaddleEvent = { name?: string };
type PaddleWindow = Window & typeof globalThis & {
  Paddle?: {
    Environment: { set(environment: "sandbox"): void };
    Initialize(options: { token: string; checkout: { settings: Record<string, unknown> }; eventCallback(event: PaddleEvent): void }): void;
    Checkout: { open(options: { transactionId: string; settings: Record<string, unknown> }): void };
  };
};

export function PaddleCheckout(props: {
  transactionId: string;
  clientToken: string;
  environment: "sandbox" | "live";
  locale: "ar" | "en";
  successPath: string;
  cancelPath: string;
  copy: { title: string; description: string; loading: string; retry: string; unavailable: string };
}) {
  const [state, setState] = useState<"loading" | "open" | "error">("loading");
  const initialized = useRef(false);
  const completed = useRef(false);

  function openCheckout() {
    const paddle = (window as PaddleWindow).Paddle;
    if (!paddle) return setState("error");
    try {
      if (!initialized.current) {
        if (props.environment === "sandbox") paddle.Environment.set("sandbox");
        paddle.Initialize({
          token: props.clientToken,
          checkout: { settings: { displayMode: "overlay", locale: props.locale, theme: "light", variant: "one-page" } },
          eventCallback(event) {
            if (event.name === "checkout.completed") completed.current = true;
            if (event.name === "checkout.closed" && !completed.current) window.location.assign(props.cancelPath);
            if (event.name === "checkout.error") setState("error");
          },
        });
        initialized.current = true;
      }
      paddle.Checkout.open({
        transactionId: props.transactionId,
        settings: {
          displayMode: "overlay",
          locale: props.locale,
          theme: "light",
          variant: "one-page",
          successUrl: new URL(props.successPath, window.location.origin).toString(),
        },
      });
      setState("open");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 px-6 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <Script src="https://cdn.paddle.com/paddle/v2/paddle.js" strategy="afterInteractive" onLoad={openCheckout} onError={() => setState("error")} />
      <section className="w-full max-w-lg rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-2xl font-semibold">{props.copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{props.copy.description}</p>
        <p className="mt-6 text-sm" role="status">{state === "error" ? props.copy.unavailable : props.copy.loading}</p>
        {state !== "open" && <button type="button" onClick={openCheckout} className="mt-5 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-neutral-950">{props.copy.retry}</button>}
      </section>
    </main>
  );
}
