-- CreateTable
CREATE TABLE "SiteDailyStat" (
    "day" DATE NOT NULL,
    "event" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SiteDailyStat_pkey" PRIMARY KEY ("day","event","page","source")
);

-- CreateIndex
CREATE INDEX "SiteDailyStat_day_idx" ON "SiteDailyStat"("day");
