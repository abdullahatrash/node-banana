"use client";

interface StatusDotProps {
  status: "connected" | "needs-reauth" | "disabled";
  size?: "sm" | "md";
}

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-green-500",
  "needs-reauth": "bg-red-500",
  disabled: "bg-neutral-500",
};

export function StatusDot({ status, size = "sm" }: StatusDotProps) {
  const sizeClass = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";

  return (
    <span
      className={`inline-block rounded-full ${sizeClass} ${STATUS_STYLES[status]}`}
      title={
        status === "connected"
          ? "Connected"
          : status === "needs-reauth"
            ? "Needs reconnection"
            : "Disabled"
      }
    />
  );
}
