import "server-only";
import type { PlotFacing, PlotStatus } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { billingConfig, providerFor } from "@/lib/billing/provider";
import { bookingAvailability, bookingConfig } from "@/lib/booking/config";
import { entitlementsForBuilder } from "@/lib/entitlements";
import { loadLayoutMap, type LayoutMapData } from "@/lib/layout-map/service";
import { listProgress, type PublicProgress } from "@/lib/progress/service";
import { ratingSummary, type RatingSummary } from "@/lib/reviews/service";
import { plotCountsByStatus } from "@/lib/plots/service";
import { safePublicUrl } from "@/lib/storage/url";

function paymentsConfigured(): boolean {
  try {
    return providerFor(billingConfig()) !== null;
  } catch {
    return false;
  }
}

function bookingOffer(project: {
  status: string;
  tokenAmount: number | null;
  builder: { status: string; payoutAccountId: string | null };
}): { available: boolean; tokenPaise: number | null } {
  const result = bookingAvailability({
    config: bookingConfig(),
    paymentsConfigured: paymentsConfigured(),
    projectLive: project.status === "LIVE",
    builderVerified: project.builder.status === "VERIFIED",
    payoutAccountId: project.builder.payoutAccountId,
    tokenRupees: project.tokenAmount,
  });
  return { available: result.available, tokenPaise: result.available ? result.tokenPaise : null };
}

/** Everything the project page needs, with file addresses already worked out. */
export type ProjectViewData = {
  project: {
    id: string;
    name: string;
    slug: string | null;
    type: string;
    stage: string;
    status: string;
    city: string | null;
    locality: string | null;
    addressLine: string | null;
    mapUrl: string | null;
    description: string | null;
    acres: number | null;
    totalPlots: number | null;
    openAreaPercent: number | null;
    phasesCount: number | null;
    landUse: string | null;
    titleStatus: string | null;
    bankLoans: string[];
    startDate: Date | null;
    completionDate: Date | null;
    percentComplete: number | null;
    pricePerSqft: number | null;
    tokenAmount: number | null;
    paymentPlan: string | null;
    additionalCharges: string | null;
    offers: string | null;
    amenities: string[];
    videoUrl: string | null;
    tourUrl: string | null;
    contactName: string | null;
    contactMobile: string | null;
    whatsapp: string | null;
    visitingHours: string | null;
    hideContactNumber: boolean;
  };
  builder: {
    id: string;
    companyName: string | null;
    slug: string | null;
    verified: boolean;
    logoUrl: string | null;
    yearEstablished: number | null;
    /** Published reviews of the company: average and count. */
    rating: RatingSummary;
  };
  photos: { id: string; url: string; thumbUrl: string; isCover: boolean }[];
  layoutUrl: string | null;
  brochureUrl: string | null;
  /** The interactive map, when the company's plan includes it and one was drawn. */
  layoutMap: LayoutMapData | null;
  /** Whether a plot of this project can be booked online right now (token paid through the gateway). */
  booking: { available: boolean; tokenPaise: number | null };
  /** Dated construction updates, newest first. */
  progress: PublicProgress[];
  approvals: {
    id: string;
    kind: string;
    number: string | null;
    validTill: Date | null;
    verified: boolean;
    verifiedAt: Date | null;
  }[];
  plots: {
    id: string;
    number: string;
    sizeSqft: number;
    dimensions: string | null;
    facing: PlotFacing | null;
    isCorner: boolean;
    price: number | null;
    status: PlotStatus;
  }[];
  plotCounts: Record<PlotStatus, number> & { total: number };
  priceFrom: number | null;
  priceTo: number | null;
  sizeFrom: number | null;
  sizeTo: number | null;
};

const DEFAULT_PLOTS = 60;

export async function loadProjectView(
  projectId: string,
  options: { plotLimit?: number } = {},
): Promise<ProjectViewData | null> {
  const db = getDb();
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      builder: {
        select: {
          id: true,
          companyName: true,
          status: true,
          logoKey: true,
          slug: true,
          yearEstablished: true,
          payoutAccountId: true,
        },
      },
      approvals: { orderBy: { kind: "asc" } },
      media: { orderBy: [{ isCover: "desc" }, { createdAt: "asc" }] },
    },
  });
  if (!project) return null;

  const [plots, plotCounts, aggregate, rating, entitlements, progress] = await Promise.all([
    db.plot.findMany({
      where: { projectId },
      orderBy: { sortKey: "asc" },
      take: options.plotLimit ?? DEFAULT_PLOTS,
    }),
    plotCountsByStatus(db, projectId),
    db.plot.aggregate({
      where: { projectId },
      _min: { price: true, sizeSqft: true },
      _max: { price: true, sizeSqft: true },
    }),
    ratingSummary(db, project.builder.id),
    entitlementsForBuilder(db, project.builder.id),
    listProgress(db, projectId, 10),
  ]);
  // The map is a plan feature: it is shown only while the company's plan includes it.
  const layoutMap = entitlements.layoutMap ? await loadLayoutMap(db, projectId) : null;

  const photos = project.media
    .filter((m) => m.kind === "PHOTO")
    .flatMap((m) => {
      const url = safePublicUrl(m.storageKey, 1200);
      const thumbUrl = safePublicUrl(m.storageKey, 320);
      return url && thumbUrl ? [{ id: m.id, url, thumbUrl, isCover: m.isCover }] : [];
    });
  const fileUrl = (kind: "LAYOUT" | "BROCHURE") => {
    const item = project.media.find((m) => m.kind === kind);
    return item ? safePublicUrl(item.storageKey) : null;
  };

  return {
    project,
    builder: {
      id: project.builder.id,
      companyName: project.builder.companyName,
      slug: project.builder.slug,
      verified: project.builder.status === "VERIFIED",
      logoUrl: safePublicUrl(project.builder.logoKey, 96),
      yearEstablished: project.builder.yearEstablished,
      rating,
    },
    photos,
    layoutUrl: fileUrl("LAYOUT"),
    brochureUrl: fileUrl("BROCHURE"),
    layoutMap,
    booking: bookingOffer(project),
    progress,
    approvals: project.approvals.map((a) => ({
      id: a.id,
      kind: a.kind,
      number: a.number,
      validTill: a.validTill,
      verified: a.verified,
      verifiedAt: a.verifiedAt,
    })),
    plots,
    plotCounts,
    // The builder's own price band wins; otherwise it is worked out from the plots.
    priceFrom: project.budgetFrom ?? aggregate._min.price,
    priceTo: project.budgetTo ?? aggregate._max.price,
    sizeFrom: aggregate._min.sizeSqft,
    sizeTo: aggregate._max.sizeSqft,
  };
}
