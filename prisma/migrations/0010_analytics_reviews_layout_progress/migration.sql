-- CreateEnum
CREATE TYPE "StatEvent" AS ENUM ('VIEW', 'CALL', 'WHATSAPP', 'SHORTLIST', 'ENQUIRY', 'VISIT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateTable
CREATE TABLE "ProjectDailyStat" (
    "projectId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "event" "StatEvent" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'direct',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectDailyStat_pkey" PRIMARY KEY ("projectId","day","event","source")
);

-- CreateTable
CREATE TABLE "PerformanceReport" (
    "builderId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceReport_pkey" PRIMARY KEY ("builderId","month")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedById" TEXT,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutShape" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayoutShape_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "photoKey" TEXT,
    "createdById" TEXT NOT NULL,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDailyStat_day_idx" ON "ProjectDailyStat"("day");

-- CreateIndex
CREATE INDEX "Review_builderId_status_createdAt_idx" ON "Review"("builderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_builderId_buyerId_key" ON "Review"("builderId", "buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "LayoutShape_plotId_key" ON "LayoutShape"("plotId");

-- CreateIndex
CREATE INDEX "LayoutShape_projectId_idx" ON "LayoutShape"("projectId");

-- CreateIndex
CREATE INDEX "ProgressUpdate_projectId_createdAt_idx" ON "ProgressUpdate"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectDailyStat" ADD CONSTRAINT "ProjectDailyStat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReport" ADD CONSTRAINT "PerformanceReport_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutShape" ADD CONSTRAINT "LayoutShape_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutShape" ADD CONSTRAINT "LayoutShape_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
