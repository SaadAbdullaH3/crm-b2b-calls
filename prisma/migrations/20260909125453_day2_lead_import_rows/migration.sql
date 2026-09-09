-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('READY', 'DUPLICATE', 'MISSING_INFO', 'INVALID_PHONE', 'INVALID');

-- CreateEnum
CREATE TYPE "DuplicateResolution" AS ENUM ('PENDING', 'REJECT', 'KEEP_BOTH', 'UPDATE_EXISTING', 'MANUAL_REVIEW');

-- AlterTable
ALTER TABLE "lead_imports" ADD COLUMN     "detected_columns" JSONB;

-- CreateTable
CREATE TABLE "lead_import_rows" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'READY',
    "issues" JSONB,
    "duplicate_of_lead_id" TEXT,
    "duplicate_of_row_number" INTEGER,
    "duplicate_matched_on" JSONB,
    "resolution" "DuplicateResolution" NOT NULL DEFAULT 'PENDING',
    "imported_lead_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_import_rows_import_id_status_idx" ON "lead_import_rows"("import_id", "status");

-- CreateIndex
CREATE INDEX "lead_import_rows_duplicate_of_lead_id_idx" ON "lead_import_rows"("duplicate_of_lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_import_rows_import_id_row_number_key" ON "lead_import_rows"("import_id", "row_number");

-- AddForeignKey
ALTER TABLE "lead_import_rows" ADD CONSTRAINT "lead_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "lead_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_import_rows" ADD CONSTRAINT "lead_import_rows_duplicate_of_lead_id_fkey" FOREIGN KEY ("duplicate_of_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_import_rows" ADD CONSTRAINT "lead_import_rows_imported_lead_id_fkey" FOREIGN KEY ("imported_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
