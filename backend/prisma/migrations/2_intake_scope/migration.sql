-- CreateEnum
CREATE TYPE "ApiTokenScope" AS ENUM ('full', 'intake');

-- AlterTable
ALTER TABLE "api_tokens" ADD COLUMN     "scope" "ApiTokenScope" NOT NULL DEFAULT 'full';

-- CreateTable
CREATE TABLE "intake_create_receipts" (
    "id" SERIAL NOT NULL,
    "api_token_id" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "ticket_id" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_create_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intake_create_receipts_api_token_id_idempotency_key_key" ON "intake_create_receipts"("api_token_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "intake_create_receipts" ADD CONSTRAINT "intake_create_receipts_api_token_id_fkey" FOREIGN KEY ("api_token_id") REFERENCES "api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_create_receipts" ADD CONSTRAINT "intake_create_receipts_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

