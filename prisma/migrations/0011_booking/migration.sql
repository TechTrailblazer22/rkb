-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUND_DUE', 'REFUNDED');

-- AlterTable
ALTER TABLE "Builder" ADD COLUMN     "payoutAccountId" TEXT;

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "plotId" TEXT,
    "plotNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerMobile" TEXT NOT NULL,
    "tokenPaise" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_providerOrderId_key" ON "Booking"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_providerPaymentId_key" ON "Booking"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Booking_plotId_status_idx" ON "Booking"("plotId", "status");

-- CreateIndex
CREATE INDEX "Booking_status_holdExpiresAt_idx" ON "Booking"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Booking_builderId_createdAt_idx" ON "Booking"("builderId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_buyerId_createdAt_idx" ON "Booking"("buyerId", "createdAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
