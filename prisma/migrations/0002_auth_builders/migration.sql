-- CreateEnum
CREATE TYPE "BuilderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BuilderMemberRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT;

-- CreateTable
CREATE TABLE "Builder" (
    "id" TEXT NOT NULL,
    "companyName" TEXT,
    "status" "BuilderStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Builder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuilderMember" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BuilderMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuilderMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Builder_status_idx" ON "Builder"("status");

-- CreateIndex
CREATE INDEX "BuilderMember_userId_idx" ON "BuilderMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderMember_builderId_userId_key" ON "BuilderMember"("builderId", "userId");

-- AddForeignKey
ALTER TABLE "BuilderMember" ADD CONSTRAINT "BuilderMember_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderMember" ADD CONSTRAINT "BuilderMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

