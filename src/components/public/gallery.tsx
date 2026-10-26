"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";

type Photo = { id: string; url: string; thumbUrl: string };

/**
 * The project's photos: one large picture and a few small ones, and a full-screen viewer that
 * works with arrow keys, the Escape key and the buttons. It is a native <dialog>, so the
 * browser handles focus, the Escape key and the page behind it.
 */
export function Gallery({
  photos,
  name,
  fallback,
}: {
  photos: Photo[];
  name: string;
  fallback: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (index !== null && !element.open) element.showModal();
    if (index === null && element.open) element.close();
  }, [index]);

  if (photos.length === 0)
    return <div className="bg-navy-900 overflow-hidden rounded-2xl">{fallback}</div>;

  const open = (i: number) => setIndex(i);
  const step = (delta: number) =>
    setIndex((i) => (i === null ? i : (i + delta + photos.length) % photos.length));
  const side = photos.slice(1, 3);
  const hidden = photos.length - 3;

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <button
          type="button"
          onClick={() => open(0)}
          aria-label={`Open photo 1 of ${photos.length} in full screen`}
          className="bg-navy-900 relative aspect-[4/3] overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 sm:row-span-2 sm:aspect-[16/10]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- builder photo, sized by CSS */}
          <img
            src={photos[0].url}
            alt={`${name}, photo 1`}
            fetchPriority="high"
            decoding="async"
            className="size-full object-cover"
          />
        </button>
        {side.map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => open(i + 1)}
            aria-label={`Open photo ${i + 2} of ${photos.length} in full screen`}
            className="bg-surface relative hidden aspect-[16/10] overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 sm:block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- builder photo, sized by CSS */}
            <img
              src={photo.thumbUrl}
              alt={`${name}, photo ${i + 2}`}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
            {i === side.length - 1 && hidden > 0 && (
              <span className="bg-navy-900/60 absolute inset-0 flex items-center justify-center gap-2 text-sm font-bold text-white">
                <Images className="size-5" aria-hidden="true" /> +{hidden} more
              </span>
            )}
          </button>
        ))}
      </div>
      {photos.length > 1 && (
        <ul className="mt-2 flex gap-2 overflow-x-auto pb-1 sm:hidden" aria-label="More photos">
          {photos.slice(1).map((photo, i) => (
            <li key={photo.id} className="shrink-0">
              <button
                type="button"
                onClick={() => open(i + 1)}
                aria-label={`Open photo ${i + 2} of ${photos.length}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- builder photo, sized by CSS */}
                <img
                  src={photo.thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-16 w-24 rounded-lg object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      <dialog
        ref={dialog}
        aria-label={`${name} photos`}
        onClose={() => setIndex(null)}
        onClick={(event) => {
          if (event.target === dialog.current) setIndex(null); // a click on the dark area
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") step(1);
          if (event.key === "ArrowLeft") step(-1);
        }}
        className="m-auto size-full max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/90"
      >
        {index !== null && (
          <div className="relative flex size-full items-center justify-center p-4 sm:p-10">
            {/* eslint-disable-next-line @next/next/no-img-element -- builder photo, sized by CSS */}
            <img
              src={photos[index].url}
              alt={`${name}, photo ${index + 1} of ${photos.length}`}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setIndex(null)}
              aria-label="Close"
              className="text-navy-900 absolute top-3 right-3 flex size-11 items-center justify-center rounded-full bg-white/90 hover:bg-white"
            >
              <X className="size-6" aria-hidden="true" />
            </button>
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous photo"
                  className="text-navy-900 absolute left-2 flex size-11 items-center justify-center rounded-full bg-white/90 hover:bg-white sm:left-6"
                >
                  <ChevronLeft className="size-6" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next photo"
                  className="text-navy-900 absolute right-2 flex size-11 items-center justify-center rounded-full bg-white/90 hover:bg-white sm:right-6"
                >
                  <ChevronRight className="size-6" aria-hidden="true" />
                </button>
              </>
            )}
            <p
              className="absolute bottom-3 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white"
              aria-live="polite"
            >
              {index + 1} / {photos.length}
            </p>
          </div>
        )}
      </dialog>
    </div>
  );
}
