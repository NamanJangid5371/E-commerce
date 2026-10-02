"use client";

import { ProductImage } from "@/components/product-image";
import { cn } from "@/lib/cn";
import { Maximize2, Pause, Play, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export function productHasSpin(product: { images: string[]; spinEnabled?: boolean }) {
  return product.spinEnabled !== false && product.images.length >= 3;
}

type Props = {
  images: string[];
  alt: string;
  enableSpin?: boolean;
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 3.4;
const ZOOM_STEP = 0.4;
const INSPECT_SCALE = 2.15;
const FRAME_PX = 18;

function wrap(n: number, len: number) {
  if (len <= 0) return 0;
  return ((n % len) + len) % len;
}

function frameMs(count: number) {
  return Math.max(110, Math.min(280, 1100 / Math.max(count, 1)));
}

export function ProductViewer({ images, alt, enableSpin = true }: Props) {
  const frames = images.filter(Boolean);
  const canSpin = enableSpin && frames.length >= 3;
  const labelId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const introRef = useRef(false);
  const introTimer = useRef<number | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startIndex: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
    pinch: number | null;
  } | null>(null);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inspect, setInspect] = useState({ on: false, x: 50, y: 50 });
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const frameKey = frames.join("|");

  useEffect(() => {
    setIndex(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    introRef.current = false;
  }, [frameKey]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(pointer: coarse)");
    const sync = () => {
      setReducedMotion(motion.matches);
      setCoarse(pointer.matches);
    };
    sync();
    motion.addEventListener("change", sync);
    pointer.addEventListener("change", sync);
    return () => {
      motion.removeEventListener("change", sync);
      pointer.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!canSpin || reducedMotion || introRef.current) return;
    introRef.current = true;
    setPlaying(true);
    introTimer.current = window.setTimeout(() => {
      setPlaying(false);
      introTimer.current = null;
    }, frameMs(frames.length) * frames.length + 60);
    return () => {
      if (introTimer.current) window.clearTimeout(introTimer.current);
    };
  }, [canSpin, reducedMotion, frames.length, frameKey]);

  useEffect(() => {
    if (!playing || !canSpin) return;
    const id = window.setInterval(() => {
      setIndex((i) => wrap(i + 1, frames.length));
    }, frameMs(frames.length));
    return () => window.clearInterval(id);
  }, [playing, canSpin, frames.length]);

  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(false), 4200);
    return () => window.clearTimeout(id);
  }, [hint]);

  useEffect(() => {
    if (!expanded) return;
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setPlaying(false);
      setHint(false);
      const dir = e.deltaY < 0 ? 1 : -1;
      setZoom((z) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((z + dir * ZOOM_STEP).toFixed(2))));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [expanded]);

  const stopPlay = useCallback(() => {
    if (introTimer.current) {
      window.clearTimeout(introTimer.current);
      introTimer.current = null;
    }
    setPlaying(false);
    setHint(false);
  }, []);

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      stopPlay();
      setZoom((z) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((z + dir * ZOOM_STEP).toFixed(2))));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    },
    [stopPlay],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setInspect({ on: false, x: 50, y: 50 });
  }, []);

  function touchPinch(e: ReactPointerEvent<HTMLDivElement> | TouchEvent) {
    const touches = "touches" in e ? e.touches : null;
    if (touches && touches.length >= 2) {
      return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    }
    return null;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopPlay();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startIndex: index,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
      pinch: touchPinch(e),
    };
    setDragging(true);
    setInspect((s) => ({ ...s, on: false }));
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    const drag = dragRef.current;

    if (!drag) {
      if (coarse || zoom > 1 || playing) return;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setInspect({ on: true, x, y });
      return;
    }

    const pinch = touchPinch(e);
    if (pinch && drag.pinch) {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * (pinch / drag.pinch)));
      setZoom(next);
      drag.pinch = pinch;
      drag.moved = true;
      if (next === 1) setPan({ x: 0, y: 0 });
      return;
    }

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;

    if (zoom > 1) {
      setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
      return;
    }

    if (!canSpin) return;
    setIndex(wrap(drag.startIndex - Math.round(dx / FRAME_PX), frames.length));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (drag && !drag.moved && zoom === 1) setExpanded(true);
  }

  function onKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      stopPlay();
      setIndex((i) => wrap(i + 1, frames.length));
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      stopPlay();
      setIndex((i) => wrap(i - 1, frames.length));
    }
    if (e.key === "+" || e.key === "=") stepZoom(1);
    if (e.key === "-" || e.key === "_") stepZoom(-1);
    if (e.key === "Escape" && expanded) {
      setExpanded(false);
      resetView();
    }
  }

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
        resetView();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, resetView]);

  if (!frames.length) return null;

  const scale = zoom > 1 ? zoom : inspect.on ? INSPECT_SCALE : 1;
  const origin = zoom > 1 ? "center center" : inspect.on ? `${inspect.x}% ${inspect.y}%` : "center center";
  const hintCopy = coarse
    ? canSpin
      ? "Swipe to rotate · Open for a closer look"
      : "Tap to inspect"
    : canSpin
      ? "Drag to rotate · Hover to zoom"
      : "Hover to zoom · Click to inspect";

  const stage = (
    <div
      ref={stageRef}
      role="region"
      aria-labelledby={labelId}
      aria-label={`${alt}, view ${index + 1} of ${frames.length}`}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (!dragRef.current) setInspect({ on: false, x: 50, y: 50 });
      }}
      className={cn(
        "product-viewer-stage relative overflow-hidden bg-ivory",
        expanded ? "h-full min-h-[70vh] w-full" : "aspect-square rounded-xl border border-line",
        canSpin && zoom === 1 && "is-spin",
        inspect.on && zoom === 1 && "is-inspect",
        (zoom > 1 || dragging) && "is-dragging",
      )}
    >
      <span id={labelId} className="sr-only">
        {alt}
      </span>
      <div
        className="product-viewer-layer absolute inset-0"
        style={{
          transform: `translate(${zoom > 1 ? pan.x : 0}px, ${zoom > 1 ? pan.y : 0}px) scale(${scale})`,
          transformOrigin: origin,
          transition: inspect.on || dragging || zoom > 1 ? "none" : "transform 0.28s ease",
        }}
      >
        {frames.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className="absolute inset-0"
            style={{ opacity: i === index ? 1 : 0 }}
            aria-hidden={i !== index}
          >
            <ProductImage
              src={src}
              alt=""
              fill
              priority={i === 0}
              sizes={expanded ? "100vw" : "50vw"}
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {canSpin && (
        <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-full border border-line bg-paper/95 px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] text-ink uppercase">
          360°
        </span>
      )}

      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        <IconBtn label="Zoom in" onClick={() => stepZoom(1)}>
          <ZoomIn size={15} />
        </IconBtn>
        <IconBtn label="Zoom out" onClick={() => stepZoom(-1)} disabled={zoom <= 1}>
          <ZoomOut size={15} />
        </IconBtn>
        {!expanded && (
          <IconBtn label="View larger" onClick={() => setExpanded(true)}>
            <Maximize2 size={15} />
          </IconBtn>
        )}
      </div>

      {canSpin && (
        <div className="absolute bottom-3 left-3 z-10 flex gap-1.5">
          <IconBtn
            label={playing ? "Pause rotation" : "Play 360 rotation"}
            onClick={() => {
              setHint(false);
              if (zoom > 1) resetView();
              if (introTimer.current) {
                window.clearTimeout(introTimer.current);
                introTimer.current = null;
              }
              setPlaying((p) => !p);
            }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </IconBtn>
          <IconBtn
            label="Rotate one step"
            onClick={() => {
              stopPlay();
              setIndex((i) => wrap(i + 1, frames.length));
            }}
          >
            <RotateCw size={15} />
          </IconBtn>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1">
        {frames.map((_, i) => (
          <span
            key={i}
            className={cn("h-1 rounded-full transition-all", i === index ? "w-4 bg-ink" : "w-1 bg-ink/25")}
          />
        ))}
      </div>

      {hint && (
        <p className="product-viewer-hint pointer-events-none absolute inset-x-0 bottom-8 z-10 text-center text-[11px] tracking-wide text-ink-soft">
          {hintCopy}
        </p>
      )}
    </div>
  );

  return (
    <div>
      {expanded ? <div className="aspect-square rounded-xl border border-line bg-ivory" aria-hidden /> : stage}

      <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-5">
        {frames.map((src, i) => (
          <button
            type="button"
            key={`${src}-thumb-${i}`}
            aria-label={`${alt} view ${i + 1}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => {
              stopPlay();
              setIndex(i);
              if (zoom > 1) resetView();
            }}
            className={cn(
              "relative aspect-square overflow-hidden rounded-xl transition",
              i === index ? "ring-1 ring-gold-deep" : "ring-1 ring-transparent opacity-70 hover:opacity-100",
            )}
          >
            <ProductImage src={src} alt={`${alt} view ${i + 1}`} fill />
          </button>
        ))}
      </div>

      {expanded && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-espresso/95 p-3 sm:p-6" role="dialog" aria-modal="true">
          <div className="mb-3 flex items-center justify-between text-ivory">
            <p className="text-[11px] tracking-[0.18em] uppercase">
              {alt} · {index + 1} / {frames.length}
            </p>
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                resetView();
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-[11px] tracking-widest uppercase"
            >
              <X size={14} /> Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/30">{stage}</div>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className="rounded-full border border-line bg-paper/95 p-2 text-ink shadow-sm transition hover:border-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}
