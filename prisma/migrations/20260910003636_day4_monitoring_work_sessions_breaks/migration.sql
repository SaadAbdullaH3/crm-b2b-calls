-- CreateEnum
CREATE TYPE "WorkSessionState" AS ENUM ('ACTIVE', 'IDLE', 'BREAK', 'ENDED');

-- CreateTable
CREATE TABLE "work_sessions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state" "WorkSessionState" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "last_heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_ms" INTEGER NOT NULL DEFAULT 0,
    "idle_ms" INTEGER NOT NULL DEFAULT 0,
    "break_ms" INTEGER NOT NULL DEFAULT 0,
    "idle_count" INTEGER NOT NULL DEFAULT 0,
    "break_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_periods" (
    "id" TEXT NOT NULL,
    "work_session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "reason" TEXT,
    "auto_closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "break_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_sessions_session_id_key" ON "work_sessions"("session_id");

-- CreateIndex
CREATE INDEX "work_sessions_user_id_started_at_idx" ON "work_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "work_sessions_state_idx" ON "work_sessions"("state");

-- CreateIndex
CREATE INDEX "work_sessions_state_last_activity_at_idx" ON "work_sessions"("state", "last_activity_at");

-- CreateIndex
CREATE INDEX "break_periods_user_id_started_at_idx" ON "break_periods"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "break_periods_work_session_id_idx" ON "break_periods"("work_session_id");

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_periods" ADD CONSTRAINT "break_periods_work_session_id_fkey" FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_periods" ADD CONSTRAINT "break_periods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
