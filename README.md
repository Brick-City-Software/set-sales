# Set Sales

A Shopify app that allows merchants to easily put products on sale by modifying the price and compare-at price fields.

## Features

- **Create Sales**: Set up sales with percentage off, fixed amount off, or fixed price discounts
- **Product Selection**: Browse and search products, select individual variants to include in a sale
- **Live Price Preview**: See calculated sale prices before applying
- **Sale Management**: View active and ended sales from the dashboard
- **Price Restoration**: End a sale to automatically restore original prices
- **Existing Sale Detection**: Variants already on sale are flagged and skipped
- **Duplicate Prevention**: Race condition protection prevents variants from being added to multiple active sales
- **Input Validation**: Comprehensive validation for sale names, discount types, and values
- **Variant Limits**: Support for up to 500 variants per sale with clear UI feedback
- **Loading States**: Visual feedback during pagination and search operations

## How It Works

When a sale is applied, the app:
1. Validates that variants are not already in an active sale (race condition prevention)
2. Creates a sale record in the database with "pending" status
3. Updates variant prices in Shopify via GraphQL API
4. Sets the variant's `compareAtPrice` to the original price (displayed as crossed-out)
5. Sets the variant's `price` to the calculated sale price
6. Updates sale status to "active" on success, or deletes the sale on failure (rollback)

When a sale is ended, the app:
1. Restores the original prices from the database via bulk update
2. Clears the `compareAtPrice` field
3. Updates the sale status to "ended"
4. Collects and reports any errors that occur during restoration

## Tech Stack

- [React Router v7](https://reactrouter.com/) - Full-stack routing and data fetching
- [Shopify App React Router](https://shopify.dev/docs/api/shopify-app-react-router) - Shopify authentication and API access
- [Prisma](https://www.prisma.io/) - Database ORM (SQLite by default)
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components) - Shopify UI components

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) v20.19+ or v22.12+
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)

### Setup

```shell
npm install
npm run setup
```

### Local Development

```shell
npm run dev
```

This starts the Shopify CLI which handles tunneling, environment variables, and OAuth.

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local development server |
| `npm run build` | Build for production |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm run setup` | Generate Prisma client and run migrations |
| `npm run deploy` | Deploy to Shopify |

## Project Structure

```
app/
├── routes/
│   ├── app.tsx                 # App layout with navigation
│   ├── app.sales._index.tsx    # Sales dashboard
│   ├── app.sales.new.tsx       # Create new sale
│   ├── app.sales.$saleId.tsx   # Sale detail/management
│   ├── auth.login/             # Authentication
│   └── webhooks.*.tsx          # Webhook handlers
├── utils/
│   └── pricing.ts              # Shared pricing calculation and formatting utilities
├── constants/
│   ├── limits.ts               # Business logic limits (variants per sale, etc.)
│   └── pagination.ts           # Pagination constants for API queries
├── types/
│   └── shopify.ts              # Shared TypeScript types for Shopify data
├── shopify.server.ts           # Shopify app configuration
└── db.server.ts                # Prisma client
prisma/
├── schema.prisma               # Database schema
└── migrations/                 # Database migrations
```

## Database Schema

The app adds two models to track sales:

- **Sale**: Stores sale metadata (name, discount type/value, status)
  - Status can be: "pending" (initial creation), "active" (applied to Shopify), or "ended" (prices restored)
  - Includes indexes on `shop`, `[shop, status]`, and `[shop, createdAt]` for query optimization
- **SaleVariant**: Stores original and sale prices for each variant in a sale
  - Includes unique constraint on `[saleId, variantId]` to prevent duplicates
  - Includes indexes on `variantId` and `productId` for efficient queries
  - Cascade deletion when parent sale is deleted

## Deployment

### Build

```shell
npm run build
```

### Database

**Important**: SQLite is suitable for development but not recommended for production use. Switch to a managed database for production deployments.

Update the `datasource` in `prisma/schema.prisma`:

| Database   | Provider     | Recommended For |
|------------|--------------|----------------|
| PostgreSQL | `postgresql` | Production (recommended) |
| MySQL      | `mysql`      | Production |
| MongoDB    | `mongodb`    | Production (if preferred) |

After updating the schema, run:
```shell
npm run prisma migrate deploy
```

### Hosting Options

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run)
- [Fly.io](https://fly.io/docs/js/shopify/)
- [Render](https://render.com/docs/deploy-shopify-app)

Set `NODE_ENV=production` in your environment variables.

## Code Quality & Best Practices

The codebase follows several best practices for maintainability and reliability:

### Error Handling
- Comprehensive error collection and reporting for GraphQL mutations
- Transaction-like behavior with automatic rollback on failures
- User-friendly error messages with specific details

### Data Validation
- Server-side validation for all user inputs
- JSON parsing with try-catch error handling
- Business logic constraints (e.g., percentage: 0-100, max variants: 500)

### Performance Optimizations
- Database indexes on frequently queried fields
- Efficient bulk operations for price updates
- Pagination for large product catalogs

### Code Organization
- Shared utilities for pricing calculations and formatting
- Centralized constants for business rules and pagination
- TypeScript types for type safety across components
- DRY principle with ~80+ lines of duplicate code removed

### Race Condition Prevention
- Server-side checks to prevent variants in multiple active sales
- Unique database constraints on variant assignments
- Database-first approach with status transitions

## Scopes

The app requires the following Shopify API scopes:

- `write_products` - To update product variant prices
