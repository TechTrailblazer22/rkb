"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { saveLayoutMapAction } from "@/app/(app)/portal/projects/[id]/(wizard)/layout-map/actions";

export type EditorPlot = { id: string; number: string; status: string; sizeSqft: number };
type Rect = { x: number; y: number; w: number; h: number };
type Drag =
  | { mode: "draw"; plotId: string; start: { x: number; y: number }; current: Rect }
  | { mode: "move"; plotId: string; dx: number; dy: number }
  | { mode: "resize"; plotId: string };

const STATUS_COLOUR: Record<string, string> = {
  AVAILABLE: "border-teal-700 bg-teal-500/35",
  BOOKED: "border-amber-600 bg-amber-400/40",
  HELD: "border-amber-600 bg-amber-400/40",
  SOLD: "border-slate-600 bg-slate-500/40",
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round = (n: number) => Math.round(n * 100) / 100;
const MIN = 1;

/**
 * Draws a rectangle for each plot over the layout plan. Pick a plot, drag on the map to place it,
 * then drag a rectangle to move it or its corner to resize it. Everything can also be done without a
 * pointer: arrow keys move the selected rectangle, and the table below sets exact numbers.
 */
export function LayoutMapEditor({
  projectId,
  plots,
  initial,
  imageUrl,
}: {
  projectId: string;
  plots: EditorPlot[];
  initial: Record<string, Rect>;
  imageUrl: string | null;
}) {
  const [shapes, setShapes] = useState<Record<string, Rect>>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [next, setNext] = useState<string>("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const placed = Object.keys(shapes).length;
  const unplaced = useMemo(() => plots.filter((p) => !shapes[p.id]), [plots, shapes]);
  const byId = useMemo(() => new Map(plots.map((p) => [p.id, p])), [plots]);
  // The plot to place next is the chosen one if it is still free, otherwise the first free plot.
  const nextPlot = unplaced.find((p) => p.id === next) ?? unplaced[0] ?? null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(update: (current: Record<string, Rect>) => Record<string, Rect>) {
    setShapes(update);
    setDirty(true);
    setMessage(null);
  }

  function point(event: React.PointerEvent) {
    const box = canvas.current!.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - box.left) / box.width) * 100, 0, 100),
      y: clamp(((event.clientY - box.top) / box.height) * 100, 0, 100),
    };
  }

  function onCanvasDown(event: React.PointerEvent) {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).dataset.bg) return;
    setSelected(null);
    if (!nextPlot) return;
    const p = point(event);
    canvas.current!.setPointerCapture(event.pointerId);
    setDrag({ mode: "draw", plotId: nextPlot.id, start: p, current: { ...p, w: 0, h: 0 } });
  }

  function onShapeDown(event: React.PointerEvent, plotId: string) {
    event.stopPropagation();
    setSelected(plotId);
    const p = point(event);
    const rect = shapes[plotId];
    canvas.current!.setPointerCapture(event.pointerId);
    setDrag({ mode: "move", plotId, dx: p.x - rect.x, dy: p.y - rect.y });
  }

  function onHandleDown(event: React.PointerEvent, plotId: string) {
    event.stopPropagation();
    setSelected(plotId);
    canvas.current!.setPointerCapture(event.pointerId);
    setDrag({ mode: "resize", plotId });
  }

  function onMove(event: React.PointerEvent) {
    if (!drag) return;
    const p = point(event);
    if (drag.mode === "draw") {
      const x = Math.min(drag.start.x, p.x);
      const y = Math.min(drag.start.y, p.y);
      setDrag({
        ...drag,
        current: { x, y, w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) },
      });
    } else if (drag.mode === "move") {
      change((s) => {
        const r = s[drag.plotId];
        return {
          ...s,
          [drag.plotId]: {
            ...r,
            x: round(clamp(p.x - drag.dx, 0, 100 - r.w)),
            y: round(clamp(p.y - drag.dy, 0, 100 - r.h)),
          },
        };
      });
    } else {
      change((s) => {
        const r = s[drag.plotId];
        return {
          ...s,
          [drag.plotId]: {
            ...r,
            w: round(clamp(p.x - r.x, MIN, 100 - r.x)),
            h: round(clamp(p.y - r.y, MIN, 100 - r.y)),
          },
        };
      });
    }
  }

  function onUp() {
    if (drag?.mode === "draw") {
      const r = drag.current;
      if (r.w >= MIN && r.h >= MIN) {
        change((s) => ({
          ...s,
          [drag.plotId]: { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) },
        }));
        setSelected(drag.plotId);
        setNext("");
      }
    }
    setDrag(null);
  }

  function onKey(event: React.KeyboardEvent) {
    if (!selected || !shapes[selected]) return;
    const step = event.shiftKey ? 2 : 0.5;
    const r = shapes[selected];
    const moves: Record<string, Partial<Rect>> = {
      ArrowLeft: { x: clamp(r.x - step, 0, 100 - r.w) },
      ArrowRight: { x: clamp(r.x + step, 0, 100 - r.w) },
      ArrowUp: { y: clamp(r.y - step, 0, 100 - r.h) },
      ArrowDown: { y: clamp(r.y + step, 0, 100 - r.h) },
    };
    if (moves[event.key]) {
      event.preventDefault();
      change((s) => ({ ...s, [selected]: { ...r, ...moves[event.key] } }));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(selected);
    }
  }

  function remove(plotId: string) {
    change((s) => {
      const { [plotId]: _gone, ...rest } = s;
      void _gone;
      return rest;
    });
    setSelected(null);
  }

  function setField(plotId: string, key: keyof Rect, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    change((s) => {
      const r = { ...s[plotId], [key]: value };
      return { ...s, [plotId]: r };
    });
  }

  async function save() {
    setSaving(true);
    const result = await saveLayoutMapAction(
      projectId,
      Object.entries(shapes).map(([plotId, r]) => ({ plotId, ...r })),
    );
    setSaving(false);
    setMessage({ ok: result.ok, text: result.message });
    if (result.ok) setDirty(false);
  }

  const draft = drag?.mode === "draw" ? drag.current : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-56 text-sm font-semibold">
          Plot to place next
          <select
            value={nextPlot?.id ?? ""}
            onChange={(e) => setNext(e.target.value)}
            disabled={unplaced.length === 0}
            className={`${inputClass} mt-1`}
            data-testid="next-plot"
          >
            {unplaced.length === 0 && <option value="">Every plot is placed</option>}
            {unplaced.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number} ({p.sizeSqft.toLocaleString("en-IN")} sq ft)
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className={buttonClass("primary")}
          data-testid="save-map"
        >
          {saving ? "Saving..." : "Save the map"}
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => remove(selected)}
            className={buttonClass("secondary")}
            data-testid="remove-shape"
          >
            Remove {byId.get(selected)?.number}
          </button>
        )}
      </div>
      <p className="text-sm text-slate-600" role="status" data-testid="map-status">
        {placed} of {plots.length} plots placed.{" "}
        {nextPlot ? `Drag on the map to draw plot ${nextPlot.number}.` : ""}
        {message && (
          <span
            className={
              message.ok ? "ml-1 font-semibold text-teal-800" : "ml-1 font-semibold text-red-700"
            }
          >
            {message.text}
          </span>
        )}
      </p>

      <div
        ref={canvas}
        onPointerDown={onCanvasDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
        tabIndex={0}
        role="application"
        aria-label="Layout map editor. Arrow keys move the selected plot, Delete removes it."
        data-testid="map-canvas"
        className="relative w-full touch-none overflow-hidden rounded-xl border border-slate-300 bg-white select-none focus:ring-2 focus:ring-teal-700 focus:outline-none"
        style={
          imageUrl
            ? undefined
            : {
                aspectRatio: "16 / 10",
                backgroundImage:
                  "linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)",
                backgroundSize: "5% 5%",
              }
        }
      >
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- the builder's layout plan, sized by CSS
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            data-bg="1"
            className="block h-auto w-full"
          />
        )}
        {Object.entries(shapes).map(([plotId, r]) => {
          const plot = byId.get(plotId);
          if (!plot) return null;
          const isSelected = selected === plotId;
          return (
            <div
              key={plotId}
              data-testid="map-shape"
              data-plot={plot.number}
              onPointerDown={(e) => onShapeDown(e, plotId)}
              className={`absolute flex cursor-move items-center justify-center overflow-hidden border-2 text-[10px] font-bold text-slate-900 ${STATUS_COLOUR[plot.status] ?? STATUS_COLOUR.AVAILABLE} ${isSelected ? "ring-navy-900 ring-2 ring-offset-1" : ""}`}
              style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
            >
              <span className="pointer-events-none truncate px-0.5">{plot.number}</span>
              {isSelected && (
                <span
                  onPointerDown={(e) => onHandleDown(e, plotId)}
                  className="bg-navy-900 absolute right-0 bottom-0 size-3 cursor-nwse-resize rounded-tl"
                  data-testid="resize-handle"
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
        {draft && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-teal-700 bg-teal-500/20"
            style={{
              left: `${draft.x}%`,
              top: `${draft.y}%`,
              width: `${draft.w}%`,
              height: `${draft.h}%`,
            }}
          />
        )}
      </div>

      <details className="rounded-xl border border-slate-200 bg-white p-4" data-testid="map-table">
        <summary className="cursor-pointer text-sm font-semibold text-teal-800">
          Set positions with numbers (no mouse needed)
        </summary>
        <p className="mt-2 text-xs text-slate-600">
          Each value is a percentage of the map&apos;s width (x, w) or height (y, h), measured from
          the top left corner.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th scope="col" className="py-1.5 pr-3">
                  Plot
                </th>
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <th key={k} scope="col" className="px-2 py-1.5 uppercase">
                    {k}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plots.map((plot) => {
                const r = shapes[plot.id];
                return (
                  <tr key={plot.id} className="border-b border-slate-100">
                    <th scope="row" className="py-1.5 pr-3 font-medium">
                      {plot.number}
                    </th>
                    {(["x", "y", "w", "h"] as const).map((k) => (
                      <td key={k} className="px-2 py-1">
                        {r ? (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={r[k]}
                            onChange={(e) => setField(plot.id, k, e.target.value)}
                            aria-label={`${plot.number} ${k}`}
                            className={`${inputClass} w-20 px-2 py-1.5`}
                          />
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      {r ? (
                        <button
                          type="button"
                          onClick={() => remove(plot.id)}
                          className="text-sm font-semibold text-red-700 underline"
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            change((s) => ({ ...s, [plot.id]: { x: 5, y: 5, w: 8, h: 6 } }))
                          }
                          className="text-sm font-semibold text-teal-800 underline"
                        >
                          Add
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
