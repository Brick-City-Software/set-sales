-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SaleVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originalPrice" TEXT NOT NULL,
    "salePrice" TEXT NOT NULL,
    CONSTRAINT "SaleVariant_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Sale_shop_idx" ON "Sale"("shop");

-- CreateIndex
CREATE INDEX "SaleVariant_variantId_idx" ON "SaleVariant"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleVariant_saleId_variantId_key" ON "SaleVariant"("saleId", "variantId");
