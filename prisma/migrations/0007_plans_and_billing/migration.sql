-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('MANUAL', 'GATEWAY', 'COMP');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PAID', 'VOID', 'REFUNDED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "pauseReason" TEXT;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "plan" "PlanCode" NOT NULL,
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "SubscriptionSource" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "pendingPlan" "PlanCode",
    "pendingInterval" "BillingInterval",
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "lastReminderDays" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "description" TEXT NOT NULL,
    "plan" "PlanCode" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PAID',
    "paymentMethod" TEXT NOT NULL,
    "paymentReference" TEXT,
    "billTo" JSONB NOT NULL,
    "sac" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "fy" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("fy")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "BuilderMemberRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedDay" (
    "projectId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedDay_pkey" PRIMARY KEY ("projectId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_builderId_key" ON "Subscription"("builderId");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_builderId_issuedAt_idx" ON "Invoice"("builderId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_tokenHash_key" ON "TeamInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "TeamInvite_builderId_idx" ON "TeamInvite"("builderId");

-- CreateIndex
CREATE INDEX "TeamInvite_email_idx" ON "TeamInvite"("email");

-- CreateIndex
CREATE INDEX "FeaturedDay_builderId_day_idx" ON "FeaturedDay"("builderId", "day");

-- CreateIndex
CREATE INDEX "FeaturedDay_day_idx" ON "FeaturedDay"("day");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedDay" ADD CONSTRAINT "FeaturedDay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedDay" ADD CONSTRAINT "FeaturedDay_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Companies verified before plans were enforced keep working: they get a complimentary Growth plan
-- for 90 days, which the admin can extend or replace.
INSERT INTO "Subscription" ("id", "builderId", "plan", "interval", "status", "source", "currentPeriodStart", "currentPeriodEnd", "note", "createdAt", "updatedAt")
SELECT 'comp_' || "id", "id", 'GROWTH', 'MONTHLY', 'ACTIVE', 'COMP', now(), now() + interval '90 days',
       'Complimentary period for a company verified before plans were enforced.', now(), now()
FROM "Builder"
WHERE "status" = 'VERIFIED';
