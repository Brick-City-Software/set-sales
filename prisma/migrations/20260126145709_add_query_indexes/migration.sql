-- CreateIndex
CREATE INDEX "Sale_shop_status_idx" ON "Sale"("shop", "status");

-- CreateIndex
CREATE INDEX "Sale_shop_createdAt_idx" ON "Sale"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "SaleVariant_productId_idx" ON "SaleVariant"("productId");
