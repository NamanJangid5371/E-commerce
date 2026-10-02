"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { MonthPoint } from "@/lib/monthly-analytics";

type Props = {
  title: string;
  subtitle?: string;
  data: MonthPoint[];
  formatTick: (n: number) => string;
  formatTip: (point: MonthPoint) => string;
  variant?: "bar" | "area";
  color?: string;
  headerActions?: ReactNode;
  /** Fixed/minimum Y-axis ceiling (e.g. ₹10L). Grows if data exceeds it. */
  maxValue?: number;
};

export function TrendChart({
  title,
  subtitle,
  data,
  formatTick,
  formatTip,
  variant = "bar",
  color = "#b33b2b",
  headerActions,
  maxValue,
}: Props) {
  const [active, setActive] = useState<number | null>(null);
  const dataMax = Math.max(...data.map((d) => d.value), 1);
  const max = Math.max(dataMax, maxValue ?? 0, 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] ?? { key: "", label: "—", value: 0 });

  const geometry = useMemo(() => {
    const w = 640;
    const h = 220;
    const padL = 52;
    const padR = 16;
    const padT = 16;
    const padB = 36;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const dense = data.length > 14;
    const gap = variant === "bar" ? (dense ? 2 : 10) : 0;
    const barW = data.length ? (innerW - gap * (data.length - 1)) / data.length : innerW;
    const y = (v: number) => padT + innerH - (v / max) * innerH;
    const ticks = [0, 0.5, 1].map((t) => ({ v: max * t, y: y(max * t) }));
    const points = data.map((d, i) => ({
      ...d,
      i,
      cx: variant === "bar" ? padL + i * (barW + gap) : padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
      cy: y(d.value),
      barW,
    }));
    const areaPath =
      points.length === 0
        ? ""
        : `M ${points[0].cx} ${padT + innerH} ` +
          points.map((p) => `L ${p.cx} ${p.cy}`).join(" ") +
          ` L ${points[points.length - 1].cx} ${padT + innerH} Z`;
    const linePath =
      points.length === 0 ? "" : `M ${points.map((p) => `${p.cx} ${p.cy}`).join(" L ")}`;
    const labelStep = data.length <= 14 ? 1 : Math.ceil(data.length / 10);
    return { w, h, padL, padT, padB, innerH, ticks, points, areaPath, linePath, labelStep, dense };
  }, [data, max, variant]);

  const hover = active != null ? geometry.points[active] : null;

  return (
    <div className="border border-line bg-paper p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] uppercase tracking-widest text-gold-deep">{title}</p>
            {headerActions}
          </div>
          {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
        </div>
        <div className="text-right">
          <p className="text-xl font-medium">{formatTick(total)}</p>
          <p className="text-[11px] uppercase tracking-widest text-ink-soft">
            Peak {peak?.label ?? "—"} · {formatTick(peak?.value ?? 0)}
          </p>
        </div>
      </div>
      <div className="relative mt-4">
        <svg viewBox={`0 0 ${geometry.w} ${geometry.h}`} className="h-52 w-full" role="img" aria-label={title}>
          {geometry.ticks.map((t) => (
            <g key={t.v}>
              <line x1={geometry.padL} x2={640 - 16} y1={t.y} y2={t.y} stroke="#e5e5e5" strokeWidth="1" />
              <text x={geometry.padL - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="#5f5f5f">
                {formatTick(t.v)}
              </text>
            </g>
          ))}
          {variant === "area" && (
            <>
              <path d={geometry.areaPath} fill={color} opacity="0.16" />
              <path d={geometry.linePath} fill="none" stroke={color} strokeWidth="2.5" />
              {geometry.points.map((p) => (
                <circle key={p.key} cx={p.cx} cy={p.cy} r={active === p.i ? 5 : 3.5} fill={color} />
              ))}
            </>
          )}
          {variant === "bar" &&
            geometry.points.map((p) => {
              const h = geometry.padT + geometry.innerH - p.cy;
              return (
                <rect
                  key={p.key}
                  x={p.cx}
                  y={p.cy}
                  width={Math.max(p.barW, geometry.dense ? 2 : 4)}
                  height={Math.max(h, 1)}
                  fill={color}
                  opacity={active === null || active === p.i ? 1 : 0.35}
                />
              );
            })}
          {geometry.points.map((p) => (
            <rect
              key={`${p.key}-hit`}
              x={variant === "bar" ? p.cx : p.cx - 16}
              y={16}
              width={variant === "bar" ? Math.max(p.barW, 4) : 32}
              height={geometry.innerH}
              fill="transparent"
              onMouseEnter={() => setActive(p.i)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
          {geometry.points.map((p) => {
            const show =
              p.i === 0 ||
              p.i === geometry.points.length - 1 ||
              p.i % geometry.labelStep === 0;
            if (!show) return null;
            const text =
              geometry.dense && /^\d/.test(p.label)
                ? String(Number(p.key.slice(8)))
                : p.label.split(" ")[0];
            return (
              <text
                key={`${p.key}-lbl`}
                x={variant === "bar" ? p.cx + p.barW / 2 : p.cx}
                y={geometry.h - 12}
                textAnchor="middle"
                fontSize={geometry.dense ? 9 : 11}
                fill="#5f5f5f"
              >
                {text}
              </text>
            );
          })}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 border border-line bg-paper px-3 py-2 text-xs shadow-sm">
            <p className="font-medium">{hover.label}</p>
            <p className="text-ink-soft">{formatTip(hover)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

