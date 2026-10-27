-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PlanChange" AS ENUM ('SUBSCRIBE', 'RENEW', 'UPGRADE');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "refundNote" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "supplier" JSONB;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "paidSubtotalPaise" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL DEFAULT 'SUBSCRIPTION',
    "change" "PlanChange" NOT NULL,
    "plan" "PlanCode" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "listPaise" INTEGER NOT NULL,
    "creditPaise" INTEGER NOT NULL DEFAULT 0,
    "subtotalPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "createdById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "invoiceId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_providerOrderId_key" ON "PaymentOrder"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_providerPaymentId_key" ON "PaymentOrder"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PaymentOrder_builderId_createdAt_idx" ON "PaymentOrder"("builderId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_status_createdAt_idx" ON "PaymentOrder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_eventId_key" ON "PaymentEvent"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
