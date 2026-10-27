import { FileText, Star } from "lucide-react";
import { ProjectUpload } from "@/components/project/project-upload";
import { ConfirmSubmit } from "@/components/project/confirm-submit";
import { getDb } from "@/lib/db";
import type { Entitlements } from "@/lib/entitlements";
import { MIN_PHOTOS } from "@/lib/projects/checklist";
import type { ProjectEditMode } from "@/lib/projects/status";
import { formatBytes } from "@/lib/storage/sniff";
import { safePublicUrl } from "@/lib/storage/url";
import { deleteMedia, setCoverPhoto } from "@/app/(app)/portal/projects/actions";

/** Photos (with a cover), the layout plan and the brochure. */
export async function MediaSection({
  projectId,
  mode,
  entitlements,
}: {
  projectId: string;
  mode: ProjectEditMode;
  entitlements: Entitlements;
}) {
  const media = await getDb().projectMedia.findMany({
    where: { projectId },
    orderBy: [{ isCover: "desc" }, { createdAt: "asc" }],
  });
  const photos = media.filter((m) => m.kind === "PHOTO");
  const layout = media.find((m) => m.kind === "LAYOUT");
  const brochure = media.find((m) => m.kind === "BROCHURE");
  const editable = mode !== "locked";
  const limit = entitlements.maxPhotosPerProject;

  const fileRow = (item: typeof layout, label: string) =>
    item ? (
      <div className="bg-surface flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-sm">
        <FileText className="size-4 text-slate-500" aria-hidden="true" />
        <a
          href={safePublicUrl(item.storageKey) ?? "#"}
          target="_blank"
          rel="noopener"
          className="font-semibold text-teal-700 underline"
        >
          {item.originalName}
        </a>
        <span className="text-slate-500">{formatBytes(item.sizeBytes)}</span>
        {editable && (
          <form action={deleteMedia} className="ml-auto">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="mediaId" value={item.id} />
            <ConfirmSubmit
              message={`Remove the ${label}?`}
              className="text-sm font-semibold text-red-600 underline"
            >
              Remove
            </ConfirmSubmit>
          </form>
        )}
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6" data-section="photos">
        <h3 className="text-lg font-bold">Photos</h3>
        <p className="mt-1 text-sm text-slate-600">
          Photos are optional, and your project can go live without them, but buyers look at them
          first ({MIN_PHOTOS} or more look best). {photos.length} of {limit} added. The cover photo
          is shown first. Large photos are shrunk automatically before they are uploaded.
        </p>

        {photos.length > 0 && (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo) => {
              const url = safePublicUrl(photo.storageKey);
              return (
                <li
                  key={photo.id}
                  className="overflow-hidden rounded-xl border border-slate-200"
                  data-photo-id={photo.id}
                  data-cover={photo.isCover ? "true" : "false"}
                >
                  <div className="bg-surface relative aspect-[4/3]">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- builder-supplied image, sized by CSS
                      <img
                        src={url}
                        alt={photo.originalName}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : null}
                    {photo.isCover && (
                      <span className="text-navy-900 absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold">
                        <Star className="size-3.5" aria-hidden="true" /> Cover
                      </span>
                    )}
                  </div>
                  {editable && (
                    <div className="flex items-center justify-between gap-2 p-3">
                      {photo.isCover ? (
                        <span className="text-xs text-slate-500">Cover photo</span>
                      ) : (
                        <form action={setCoverPhoto}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="mediaId" value={photo.id} />
                          <button className="text-sm font-semibold text-teal-700 underline">
                            Make cover
                          </button>
                        </form>
                      )}
                      <form action={deleteMedia}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="mediaId" value={photo.id} />
                        <ConfirmSubmit
                          message="Remove this photo?"
                          className="text-sm font-semibold text-red-600 underline"
                        >
                          Remove
                        </ConfirmSubmit>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5">
          <ProjectUpload
            projectId={projectId}
            kind="PHOTO"
            accept="image/jpeg,image/png,image/webp"
            label="Add photos"
            multiple
            disabled={!editable || photos.length >= limit}
            hint="JPG, PNG or WebP. You can pick several at once."
          />
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6"
          data-section="layout"
        >
          <h3 className="text-lg font-bold">Layout plan</h3>
          <p className="text-sm text-slate-600">The approved layout drawing, as an image or PDF.</p>
          {fileRow(layout, "layout plan")}
          <ProjectUpload
            projectId={projectId}
            kind="LAYOUT"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            label={layout ? "Replace layout plan" : "Upload layout plan"}
            disabled={!editable}
          />
        </div>
        <div
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6"
          data-section="brochure"
        >
          <h3 className="text-lg font-bold">Brochure</h3>
          <p className="text-sm text-slate-600">Your marketing brochure, as a PDF.</p>
          {fileRow(brochure, "brochure")}
          <ProjectUpload
            projectId={projectId}
            kind="BROCHURE"
            accept="application/pdf"
            label={brochure ? "Replace brochure" : "Upload brochure"}
            disabled={!editable}
          />
        </div>
      </section>
    </div>
  );
}
