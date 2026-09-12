-- Day 7 (Dev B): RP-03 Management Score with an append-only audit trail,
-- and RP-04 report history (format, period label, row count, approval).

-- CreateEnum
CREATE TYPE "ScoreStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "ScoreEventType" AS ENUM ('CREATED', 'UPDATED', 'APPROVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('XLSX', 'PDF');

-- AlterTable
ALTER TABLE "management_scores"
    ADD COLUMN "status" "ScoreStatus" NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN "approved_by_id" TEXT,
    ADD COLUMN "approved_at" TIMESTAMP(3),
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "reports_generated"
    ADD COLUMN "scope" TEXT,
    ADD COLUMN "range_label" TEXT,
    ADD COLUMN "format" "ReportFormat" NOT NULL DEFAULT 'XLSX',
    ADD COLUMN "row_count" INTEGER,
    ADD COLUMN "file_size" INTEGER,
    ADD COLUMN "approved_by_id" TEXT,
    ADD COLUMN "approved_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "management_score_events" (
    "id" TEXT NOT NULL,
    "score_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "type" "ScoreEventType" NOT NULL,
    "from_score" INTEGER,
    "to_score" INTEGER,
    "reason" TEXT NOT NULL,
    "changes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "management_score_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "management_score_events_score_id_created_at_idx" ON "management_score_events"("score_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "management_scores_subject_id_period_start_period_end_key" ON "management_scores"("subject_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "management_scores_status_idx" ON "management_scores"("status");

-- CreateIndex
CREATE INDEX "reports_generated_approved_by_id_idx" ON "reports_generated"("approved_by_id");

-- AddForeignKey
ALTER TABLE "management_scores" ADD CONSTRAINT "management_scores_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports_generated" ADD CONSTRAINT "reports_generated_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_score_events" ADD CONSTRAINT "management_score_events_score_id_fkey" FOREIGN KEY ("score_id") REFERENCES "management_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_score_events" ADD CONSTRAINT "management_score_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
