"use client";

import { useState, type ComponentProps } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function PasswordField(props: Omit<ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);
  const t = useTranslations("auth.shell");
  return (
    <div dir="ltr" className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="h-11 pe-12" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute end-1.5 top-1.5 size-8 text-muted-foreground"
        aria-label={t(visible ? "hidePassword" : "showPassword")}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </Button>
    </div>
  );
}
