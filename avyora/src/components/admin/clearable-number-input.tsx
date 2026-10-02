"use client";

import { useState } from "react";

type Props = {
  value: number;
  onCommit: (next: number) => void;
  min?: number;
  className?: string;
  "aria-label"?: string;
};

/**
 * Number field that can be cleared while typing (so "0" is erasable),
 * then commits a finite value on blur / Enter.
 */
export function ClearableNumberInput({
  value,
  onCommit,
  min = 0,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? String(value);

  function commit(raw: string) {
    const cleaned = raw.replace(/[^\d]/g, "");
    const next = cleaned === "" ? min : Number(cleaned);
    const safe = Number.isFinite(next) ? Math.max(min, next) : min;
    onCommit(safe);
    setDraft(null);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={ariaLabel}
      value={display}
      onFocus={(e) => {
        setDraft(String(value));
        e.target.select();
      }}
      onChange={(e) => {
        // Allow empty so existing 0 can be erased and replaced.
        setDraft(e.target.value.replace(/[^\d]/g, ""));
      }}
      onBlur={() => {
        commit(draft ?? String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}
