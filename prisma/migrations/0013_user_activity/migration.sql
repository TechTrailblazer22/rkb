-- CreateTable
CREATE TABLE "UserActivity" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "mode" TEXT NOT NULL,

    CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("userId","day","mode")
);

-- CreateIndex
CREATE INDEX "UserActivity_day_mode_idx" ON "UserActivity"("day", "mode");

-- AddForeignKey
ALTER TABLE "UserActivity" ADD CONSTRAINT "UserActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
