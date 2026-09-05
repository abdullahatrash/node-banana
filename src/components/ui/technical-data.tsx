import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function TechnicalCode({ className, style, ...props }: ComponentProps<"code">) {
  return (
    <code
      dir="ltr"
      data-slot="technical-code"
      className={cn("inline-block max-w-full break-all [unicode-bidi:isolate]", className)}
      style={{ textAlign: "left", ...style }}
      {...props}
    />
  );
}

function TechnicalBlock({ className, style, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      dir="ltr"
      data-slot="technical-block"
      className={cn("overflow-auto break-all [unicode-bidi:isolate]", className)}
      style={{ textAlign: "left", ...style }}
      {...props}
    />
  );
}

export { TechnicalBlock, TechnicalCode };
