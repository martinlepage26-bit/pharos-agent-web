-- AlterTable
ALTER TABLE "MemoryItem" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MemoryItem_expiresAt_idx" ON "MemoryItem"("expiresAt");

