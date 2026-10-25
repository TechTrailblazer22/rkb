-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('PLOTTED', 'FARM_HOUSE', 'RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE');

-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('PRE_LAUNCH', 'UNDER_CONSTRUCTION', 'READY_TO_MOVE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'LIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('RERA', 'TNCP', 'MUNICIPAL', 'BANK_LOAN', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'LAYOUT', 'BROCHURE');

-- CreateEnum
CREATE TYPE "PlotStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED', 'SOLD');

-- CreateEnum
CREATE TYPE "PlotFacing" AS ENUM ('NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTH_EAST', 'NORTH_WEST', 'SOUTH_EAST', 'SOUTH_WEST');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "slug" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL,
    "stage" "ProjectStage" NOT NULL DEFAULT 'PRE_LAUNCH',
    "city" TEXT,
    "locality" TEXT,
    "addressLine" TEXT,
    "mapUrl" TEXT,
    "description" TEXT,
    "acres" DOUBLE PRECISION,
    "totalPlots" INTEGER,
    "openAreaPercent" INTEGER,
    "phasesCount" INTEGER,
    "landUse" TEXT,
    "titleStatus" TEXT,
    "bankLoans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDate" TIMESTAMP(3),
    "completionDate" TIMESTAMP(3),
    "percentComplete" INTEGER,
    "pricePerSqft" INTEGER,
    "budgetFrom" INTEGER,
    "budgetTo" INTEGER,
    "tokenAmount" INTEGER,
    "paymentPlan" TEXT,
    "additionalCharges" TEXT,
    "offers" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoUrl" TEXT,
    "contactName" TEXT,
    "contactMobile" TEXT,
    "whatsapp" TEXT,
    "visitingHours" TEXT,
    "hideContactNumber" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectApproval" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "number" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTill" TIMESTAMP(3),
    "storageKey" TEXT,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMedia" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "tag" TEXT,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sortKey" TEXT NOT NULL,
    "sizeSqft" INTEGER NOT NULL,
    "dimensions" TEXT,
    "facing" "PlotFacing",
    "isCorner" BOOLEAN NOT NULL DEFAULT false,
    "roadWidthFt" INTEGER,
    "ratePerSqft" INTEGER,
    "price" INTEGER,
    "status" "PlotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "phase" TEXT,
    "unitType" TEXT,
    "builtUpSqft" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlotStatusLog" (
    "id" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "plotNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStatus" "PlotStatus",
    "toStatus" "PlotStatus" NOT NULL,
    "actorId" TEXT,
    "via" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlotStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "Project_builderId_status_idx" ON "Project"("builderId", "status");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectApproval_projectId_kind_key" ON "ProjectApproval"("projectId", "kind");

-- CreateIndex
CREATE INDEX "ProjectMedia_projectId_kind_idx" ON "ProjectMedia"("projectId", "kind");

-- CreateIndex
CREATE INDEX "Plot_projectId_sortKey_idx" ON "Plot"("projectId", "sortKey");

-- CreateIndex
CREATE INDEX "Plot_projectId_status_idx" ON "Plot"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Plot_projectId_number_key" ON "Plot"("projectId", "number");

-- CreateIndex
CREATE INDEX "PlotStatusLog_plotId_idx" ON "PlotStatusLog"("plotId");

-- CreateIndex
CREATE INDEX "PlotStatusLog_projectId_createdAt_idx" ON "PlotStatusLog"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectApproval" ADD CONSTRAINT "ProjectApproval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMedia" ADD CONSTRAINT "ProjectMedia_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

