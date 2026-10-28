-- Publishing no longer needs a plan (a company without one is on the free plan). Projects that an
-- earlier version took offline only because a plan had ended go back live.
UPDATE "Project"
SET "status" = 'LIVE', "pauseReason" = NULL, "reviewNote" = NULL
WHERE "status" = 'PAUSED' AND "pauseReason" = 'PLAN_LAPSED';
