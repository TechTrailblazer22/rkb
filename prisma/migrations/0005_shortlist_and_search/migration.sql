-- CreateTable
CREATE TABLE "Shortlist" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateIndex
CREATE INDEX "Shortlist_projectId_idx" ON "Shortlist"("projectId");

-- CreateIndex
CREATE INDEX "Project_status_type_idx" ON "Project"("status", "type");

-- CreateIndex
CREATE INDEX "Project_status_city_idx" ON "Project"("status", "city");

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

