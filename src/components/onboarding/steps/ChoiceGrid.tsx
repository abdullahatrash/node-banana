import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChoiceOption<Value extends string> {
  value: Value;
  label: string;
}

export function ChoiceGrid<Value extends string>({
  options,
  value,
  values,
  onChange,
  columns = 3,
}: {
  options: ChoiceOption<Value>[];
  value?: Value;
  values?: Value[];
  onChange: (value: Value) => void;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
      )}
    >
      {options.map((option) => {
        const selected = value === option.value || values?.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative min-h-14 rounded-2xl border px-4 py-3 text-start text-sm font-medium transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
              selected
                ? "border-amber-300 bg-amber-300 text-stone-950 shadow-[0_0_24px_rgba(252,211,77,0.18)]"
                : "border-white/12 bg-white/[0.055] text-stone-100 hover:border-white/25 hover:bg-white/[0.09]",
            )}
          >
            {option.label}
            {selected && (
              <Check className="absolute end-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}
