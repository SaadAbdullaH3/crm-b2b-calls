/*
  Warnings:

  - The `doc_type` column on the `hr_documents` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `leave_type` column on the `leave_requests` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `uploaded_by_id` to the `hr_documents` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'CASUAL', 'BEREAVEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "HrDocumentType" AS ENUM ('UNDERTAKING', 'AGREEMENT', 'CONTRACT', 'WARNING_LETTER', 'PERFORMANCE_REVIEW', 'ID_PROOF', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "HrEventType" AS ENUM ('JOINED', 'CONFIRMED', 'PROMOTION', 'ROLE_CHANGE', 'WARNING', 'PERFORMANCE_REVIEW', 'COMMENDATION', 'PROBATION', 'EXIT', 'NOTE');

-- AlterTable
ALTER TABLE "hr_documents" ADD COLUMN     "mime_type" TEXT,
ADD COLUMN     "size_bytes" INTEGER,
ADD COLUMN     "uploaded_by_id" TEXT NOT NULL,
DROP COLUMN "doc_type",
ADD COLUMN     "doc_type" "HrDocumentType" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "hr_employees" ADD COLUMN     "address" TEXT,
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "date_of_birth" TIMESTAMP(3),
ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT,
ADD COLUMN     "employment_type" TEXT,
ADD COLUMN     "exited_at" TIMESTAMP(3),
ADD COLUMN     "shift" TEXT;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "days" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "review_comment" TEXT,
DROP COLUMN "leave_type",
ADD COLUMN     "leave_type" "LeaveType" NOT NULL DEFAULT 'ANNUAL';

-- CreateTable
CREATE TABLE "hr_employee_events" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "HrEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_employee_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_employee_events_employee_id_effective_date_idx" ON "hr_employee_events"("employee_id", "effective_date");

-- CreateIndex
CREATE INDEX "hr_employee_events_type_idx" ON "hr_employee_events"("type");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_name_date_key" ON "holidays"("name", "date");

-- CreateIndex
CREATE INDEX "hr_documents_employee_id_doc_type_idx" ON "hr_documents"("employee_id", "doc_type");

-- CreateIndex
CREATE INDEX "hr_employees_exited_at_idx" ON "hr_employees"("exited_at");

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_events" ADD CONSTRAINT "hr_employee_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_events" ADD CONSTRAINT "hr_employee_events_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
