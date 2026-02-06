-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleVariant" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originalPrice" TEXT NOT NULL,
    "salePrice" TEXT NOT NULL,

    CONSTRAINT "SaleVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sale_shop_idx" ON "Sale"("shop");

-- CreateIndex
CREATE INDEX "Sale_shop_status_idx" ON "Sale"("shop", "status");

-- CreateIndex
CREATE INDEX "Sale_shop_createdAt_idx" ON "Sale"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "SaleVariant_variantId_idx" ON "SaleVariant"("variantId");

-- CreateIndex
CREATE INDEX "SaleVariant_productId_idx" ON "SaleVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleVariant_saleId_variantId_key" ON "SaleVariant"("saleId", "variantId");

-- AddForeignKey
ALTER TABLE "SaleVariant" ADD CONSTRAINT "SaleVariant_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
