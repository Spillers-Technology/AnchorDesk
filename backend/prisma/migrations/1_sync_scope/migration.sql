-- CreateEnum
CREATE TYPE "SyncBypassStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
ALTER TYPE "SyncState" ADD VALUE 'detached';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "sync_detach_reason" TEXT,
ADD COLUMN     "sync_detached_at" TIMESTAMP(3),
ADD COLUMN     "sync_detached_revision" INTEGER,
ADD COLUMN     "sync_job_id" INTEGER,
ADD COLUMN     "sync_scope_pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "tickets_detached" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sync_bypass_requests" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "status" "SyncBypassStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "requested_by" VARCHAR(255) NOT NULL,
    "requested_by_id" INTEGER,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" VARCHAR(255),
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,

    CONSTRAINT "sync_bypass_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_bypass_requests_status_requested_at_idx" ON "sync_bypass_requests"("status", "requested_at");

-- CreateIndex
CREATE INDEX "sync_bypass_requests_ticket_id_idx" ON "sync_bypass_requests"("ticket_id");

-- CreateIndex
CREATE INDEX "tickets_sync_job_id_idx" ON "tickets"("sync_job_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sync_job_id_fkey" FOREIGN KEY ("sync_job_id") REFERENCES "sync_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_bypass_requests" ADD CONSTRAINT "sync_bypass_requests_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

