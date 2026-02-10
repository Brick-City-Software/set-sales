# Set Sales

A production-ready Shopify app that allows merchants to easily put products on sale by modifying the price and compare-at price fields. Built with React Router v7 and TypeScript, following Shopify's design guidelines and best practices.

## Features

### Sale Management
- **Create Sales**: Set up sales with percentage off, fixed amount off, or fixed price discounts
- **Product Selection**: Browse and search products, select individual variants to include in a sale
- **Active Product Filtering**: Only shows ACTIVE products (excludes archived and draft products)
- **Live Price Preview**: See calculated sale prices before applying
- **Sale Dashboard**: View active and ended sales with comprehensive statistics
- **Price Restoration**: End a sale to automatically restore original prices with confirmation modal

### User Experience
- **Polaris Design System**: Full compliance with Shopify's design guidelines
- **Responsive Tables**: Auto-adaptive tables that work on mobile and desktop
- **Empty States**: Helpful illustrations and guidance when no sales exist
- **Loading States**: Skeleton screens and visual feedback during data fetching
- **Error Boundaries**: Graceful error handling with recovery options
- **Confirmation Modals**: Polaris modals for destructive actions (no native browser dialogs)

### Data Integrity & Security
- **Duplicate Prevention**: Race condition protection prevents variants from being added to multiple active sales
- **Input Validation**: Comprehensive Zod schemas for sale names, discount types, and values
- **Rate Limiting**: Protection against abuse with configurable limits
- **Webhook Support**: Automatic cleanup on app uninstall
- **API Version Alignment**: Consistent API versions across webhooks and app code
- **Variant Limits**: Support for up to 500 variants per sale with clear UI feedback

### Monitoring & Observability
- **Error Tracking**: Sentry integration for real-time error monitoring and debugging
- **Performance Monitoring**: Track application performance and identify bottlenecks
- **Source Maps**: Automatic source map upload for readable production stack traces
- **Release Tracking**: Associate errors with specific code versions

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
- [Prisma](https://www.prisma.io/) - Database ORM with PostgreSQL
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components) - Shopify design system components
- [TypeScript](https://www.typescriptlang.org/) - Type-safe development
- [Zod](https://zod.dev/) - Runtime schema validation
- [Sentry](https://sentry.io/) - Error tracking and performance monitoring

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) v20.19+ or v22.12+
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)
- [PostgreSQL](https://www.postgresql.org/) database (local or hosted service like Supabase)

### Setup

1. **Install dependencies**:
```shell
npm install
```

2. **Configure environment variables**:
```shell
# Copy environment template
cp .env.example .env

# Edit .env and add required variables:
# DATABASE_URL="postgresql://user:password@host:5432/database"
# SENTRY_DSN="your-sentry-dsn"  # Optional for error tracking
# SENTRY_AUTH_TOKEN="your-sentry-auth-token"  # Required for source map uploads
```

3. **Run database migrations**:
```shell
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
│   ├── app.tsx                        # App layout with navigation and error boundary
│   ├── app._index.tsx                 # Dashboard with statistics
│   ├── app.sales._index.tsx           # Sales list with filters (active/ended)
│   ├── app.sales.new.tsx              # Create new sale with product browser
│   ├── app.sales.$saleId.tsx          # Sale detail and management
│   ├── auth.$.tsx                     # Authentication with webhook registration
│   └── webhooks.*.tsx                 # Webhook handlers (uninstalled, scopes_update)
├── utils/
│   ├── pricing.ts                     # Pricing calculation and formatting utilities
│   ├── date.ts                        # Date formatting utilities
│   └── rateLimit.ts                   # Rate limiting for API operations
├── constants/
│   ├── limits.ts                      # Business logic limits (500 variants per sale)
│   └── pagination.ts                  # Pagination constants for GraphQL queries
├── types/
│   └── shopify.ts                     # Shared TypeScript types for Shopify data
├── globals.d.ts                       # Type definitions for Polaris web components
├── shopify.server.ts                  # Shopify app configuration and authentication
└── db.server.ts                       # Prisma client singleton
prisma/
├── schema.prisma                      # Database schema with indexes
└── migrations/                        # Database migrations
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

### Environment Variables

Set the following environment variables in production:

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SENTRY_DSN` | No | Sentry project DSN for error tracking |
| `SENTRY_AUTH_TOKEN` | Yes* | Auth token for source map uploads (* if using Sentry) |

The Sentry Vite plugin will automatically upload source maps during build when `SENTRY_AUTH_TOKEN` is configured.

## Code Quality & Best Practices

The codebase follows Shopify's best practices and industry standards:

### UI/UX Design
- **Polaris Compliance**: Uses official Polaris web components throughout
- **Responsive Design**: Auto-adaptive tables and layouts for mobile/desktop
- **Design Tokens**: Uses CSS custom properties for colors (theme-aware)
- **Error Boundaries**: Graceful error handling on all routes
- **Loading States**: Skeleton screens for better perceived performance
- **Empty States**: Helpful illustrations and guidance
- **Confirmation Modals**: Polaris modals instead of native browser dialogs

### Error Handling
- Comprehensive error collection and reporting for GraphQL mutations
- Transaction-like behavior with automatic rollback on failures
- User-friendly error messages with specific details
- Error boundaries prevent full app crashes

### Data Validation
- Zod schemas for runtime validation of all user inputs
- Server-side validation for sale names, discount types, and values
- JSON parsing with try-catch error handling
- Business logic constraints (e.g., percentage: 0-100, max variants: 500)

### Performance Optimizations
- Database indexes on frequently queried fields (`shop`, `[shop, status]`, `variantId`)
- Efficient bulk operations for price updates via `productVariantsBulkUpdate`
- Pagination for large product catalogs (25 products per page)
- Loading states and skeleton screens for better perceived performance

### Code Organization
- Shared utilities for pricing calculations, date formatting, and rate limiting
- Centralized constants for business rules and pagination
- TypeScript types for type safety across components
- DRY principle with minimal code duplication
- Consistent file naming and structure

### Security & Reliability
- Rate limiting on critical operations (10 sale creations/min, 20 sale ends/min)
- Race condition prevention via database constraints
- Webhook registration after OAuth for reliable cleanup
- API version alignment across app and webhooks (2025-10)
- Input sanitization and validation
- Proper error logging (dev only, no sensitive data in production)

## API & Scopes

### Shopify API Version
- **2025-10** (October 2025)
- Consistent across app code and webhook configuration

### Required Scopes
- `write_products` - To update product variant prices and compare-at prices

### Webhooks
- `app/uninstalled` - Automatic session cleanup when app is uninstalled
- `app/scopes_update` - Handles permission changes

## Production Readiness

### Completed ✅
- ✅ Shopify Design Guidelines compliance
- ✅ Polaris design system integration
- ✅ Error boundaries and loading states
- ✅ Rate limiting and security measures
- ✅ Webhook registration and handling
- ✅ Input validation with Zod schemas
- ✅ Race condition prevention
- ✅ Comprehensive error handling
- ✅ Date formatting standardization
- ✅ Product filtering (active only)
- ✅ Error tracking with Sentry
- ✅ Performance monitoring
- ✅ Source map uploads for production debugging

### Recommended Before Production 🔄
- 💡 Consider implementing bulk actions
- 💡 Consider adding search/filter functionality
- 💡 Consider adding sale preview modal

See [CHANGELOG.md](./CHANGELOG.md) for detailed version history and [issue tracker](https://github.com/Brick-City-Software/set-sales/issues) for upcoming features.
