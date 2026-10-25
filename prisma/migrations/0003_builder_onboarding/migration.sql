-- CreateEnum
CREATE TYPE "BuilderType" AS ENUM ('PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OTHER');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('STARTER', 'GROWTH', 'PREMIER');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PAN', 'GST', 'BUSINESS_PROOF', 'IDENTITY_PROOF', 'ADDRESS_PROOF', 'RERA', 'BANK_PROOF');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "BuilderStatus" ADD VALUE 'CHANGES_REQUESTED';

-- AlterTable
ALTER TABLE "Builder" ADD COLUMN     "about" TEXT,
ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactMobile" TEXT,
ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "coverKey" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "interestedPlan" "PlanCode",
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "projectsCompleted" INTEGER,
ADD COLUMN     "projectsOngoing" INTEGER,
ADD COLUMN     "reraNumber" TEXT,
ADD COLUMN     "reraValidTill" TIMESTAMP(3),
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "serviceCities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "type" "BuilderType",
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "website" TEXT,
ADD COLUMN     "whatsapp" TEXT,
ADD COLUMN     "yearEstablished" INTEGER;

-- CreateTable
CREATE TABLE "BuilderDocument" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "BuilderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuilderDocument_status_idx" ON "BuilderDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderDocument_builderId_kind_key" ON "BuilderDocument"("builderId", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Builder_slug_key" ON "Builder"("slug");

-- CreateIndex
CREATE INDEX "Builder_pan_idx" ON "Builder"("pan");

-- CreateIndex
CREATE INDEX "Builder_gstin_idx" ON "Builder"("gstin");

-- AddForeignKey
ALTER TABLE "BuilderDocument" ADD CONSTRAINT "BuilderDocument_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderDocument" ADD CONSTRAINT "BuilderDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

