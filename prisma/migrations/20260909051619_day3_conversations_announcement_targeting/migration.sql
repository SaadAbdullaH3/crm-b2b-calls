/*
  Warnings:

  - You are about to drop the column `thread_key` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the `message_recipients` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `conversation_id` to the `messages` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'GROUP', 'BROADCAST');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'ROLE', 'GROUP');

-- DropForeignKey
ALTER TABLE "message_recipients" DROP CONSTRAINT "message_recipients_message_id_fkey";

-- DropForeignKey
ALTER TABLE "message_recipients" DROP CONSTRAINT "message_recipients_recipient_id_fkey";

-- DropIndex
DROP INDEX "messages_thread_key_idx";

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "audience_group_id" TEXT,
ADD COLUMN     "audience_role" TEXT;

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "thread_key",
ADD COLUMN     "conversation_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "message_recipients";

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL DEFAULT 'DIRECT',
    "title" TEXT,
    "group_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "announcement_recipients" (
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "announcement_recipients_pkey" PRIMARY KEY ("announcement_id","user_id")
);

-- CreateIndex
CREATE INDEX "conversations_type_last_message_at_idx" ON "conversations"("type", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_group_id_idx" ON "conversations"("group_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_left_at_idx" ON "conversation_participants"("user_id", "left_at");

-- CreateIndex
CREATE INDEX "announcement_recipients_user_id_idx" ON "announcement_recipients"("user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages"("conversation_id", "sent_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_audience_group_id_fkey" FOREIGN KEY ("audience_group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
