# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Set Sales is a Shopify embedded app that allows merchants to easily put products on sale by modifying the price and compare-at price fields. Built with React Router v7 and TypeScript, using Prisma for data storage.

## Commands

```bash
# Development
npm run dev              # Start local dev server with Shopify CLI (tunnels, env vars, auth)

# Build
npm run build            # Build for production (react-router build)

# Type checking
npm run typecheck        # Run TypeScript type checking

# Linting
npm run lint             # Run ESLint

# Database
npm run setup            # Generate Prisma client and run migrations
npm run prisma           # Direct Prisma CLI access

# GraphQL
npm run graphql-codegen  # Generate GraphQL types from schema

# Deployment
npm run deploy           # Deploy to Shopify
```

## Architecture

### File-Based Routing (React Router v7)

Routes are defined in `app/routes/` using React Router's file-based routing convention:
- `app.tsx` - App shell layout with navigation and error boundary
- `app._index.tsx` - Dashboard with statistics at `/app`
- `app.sales._index.tsx` - Sales list (active/ended) at `/app/sales`
- `app.sales.new.tsx` - Create new sale at `/app/sales/new`
- `app.sales.$saleId.tsx` - Sale detail page at `/app/sales/:saleId`
- `auth.$.tsx` - Catch-all auth routes at `/auth/*` with webhook registration
- `webhooks.app.uninstalled.tsx` - Webhook handler for `app/uninstalled` topic
- `webhooks.app.scopes_update.tsx` - Webhook handler for `app/scopes_update` topic

**Important**: All route files include error boundaries for graceful error handling.

### Server-Side Code Convention

Files ending in `.server.ts` or `.server.tsx` are Node-only and not bundled into the client:
- `app/shopify.server.ts` - Shopify app configuration and authentication
- `app/db.server.ts` - Prisma client singleton

### Shared Utilities and Constants

The app follows a modular structure with shared code:
- `app/utils/pricing.ts` - Pricing calculation and formatting utilities
- `app/utils/date.ts` - Date formatting utilities (standardized en-US locale)
- `app/utils/rateLimit.ts` - Rate limiting for API operations
- `app/constants/limits.ts` - Business logic limits (e.g., max variants per sale: 500)
- `app/constants/pagination.ts` - API pagination constants (25 products per page)
- `app/types/shopify.ts` - Shared TypeScript types for Shopify data structures
- `app/globals.d.ts` - Type definitions for Polaris web components

### Key Integrations

**Authentication**: All `/app/*` routes require authentication via `authenticate.admin(request)` from `shopify.server.ts`. Use `redirect` from `authenticate.admin`, not from `react-router`.

**GraphQL**: Use `admin.graphql()` for Admin API queries. API version is October 2025.

**UI Components**: Uses Polaris web components (native HTML custom elements like `<s-page>`, `<s-button>`, `<s-modal>`, `<s-table>`, `<s-empty-state>`, `<s-skeleton-page>`), not React Polaris. Type definitions are in `app/globals.d.ts`.

**Design System**:
- Uses Polaris design tokens for colors (e.g., `var(--p-color-text-subdued)`)
- All tables use `<s-table>` components with `variant="auto"` for responsive design
- Modals use `<s-modal>` with slot-based actions (no native `confirm()` dialogs)
- Empty states use `<s-empty-state>` with Shopify illustrations
- Loading states use `<s-skeleton-page>` components

**Database**: Prisma with SQLite (`prisma/dev.sqlite`) for development. Models include:
- `Session` - Shopify OAuth tokens and shop data
- `Sale` - Sale metadata (name, discount type/value, status: "pending"|"active"|"ended")
  - Indexes: `[shop]`, `[shop, status]`, `[shop, createdAt]`
- `SaleVariant` - Original and sale prices for each variant in a sale
  - Indexes: `[variantId]`, `[productId]`
  - Unique constraint: `[saleId, variantId]`

**Note**: SQLite is for development only. Production should use PostgreSQL or MySQL.

### Webhook Handling

Webhooks are configured in `shopify.app.toml` (API version: 2025-10) and handled by route files matching the pattern `webhooks.{topic}.tsx`:
- `app/uninstalled` → `webhooks.app.uninstalled.tsx` - Deletes sessions on app uninstall
- `app/scopes_update` → `webhooks.app.scopes_update.tsx` - Handles scope changes

Webhooks are automatically registered after OAuth in `auth.$.tsx` using `registerWebhooks({ session })`.

### Environment Variables

Required variables (provided automatically by `shopify app dev`):
- `SHOPIFY_API_KEY` - App API key
- `SHOPIFY_API_SECRET` - App secret
- `SHOPIFY_APP_URL` - App URL (tunnel URL in dev)
- `SCOPES` - Comma-separated OAuth scopes

## Embedded App Navigation

To avoid breaking the embedded iframe session:
1. Use `Link` from `react-router` or `@shopify/polaris`, not `<a>` tags
2. Use `redirect` from `authenticate.admin`, not from `react-router`
3. Use `useSubmit` or `useFetcher` from `react-router` for form submissions

## Code Quality Standards

### UI/UX Requirements
- **Always use Polaris web components**, never native HTML for UI elements
- **Use design tokens** for colors: `var(--p-color-text-subdued)`, `var(--p-color-text-success)`, etc.
- **Use `<s-modal>`** for confirmations, never `confirm()` or `alert()`
- **Use `<s-table>`** with `variant="auto"` for responsive tables
- **Use `<s-empty-state>`** with illustrations when lists are empty
- **Use `<s-skeleton-page>`** for loading states during navigation
- **Add error boundaries** to all new route files

### Data Validation
- **Use Zod schemas** for all user input validation
- **Server-side validation** is mandatory for all forms
- **Rate limiting** should be applied to destructive operations

### Error Handling
- **All routes must export ErrorBoundary** function
- **Use try-catch** for all GraphQL operations
- **Collect and report errors** to users with helpful messages
- **Transaction-like behavior** with rollback on failures

### Formatting Standards
- **Dates**: Use `formatDate()` from `app/utils/date.ts` (never `toLocaleDateString()`)
- **Prices**: Use utilities from `app/utils/pricing.ts`
- **Colors**: Use Polaris design tokens (never hardcoded hex/color names)

### Performance
- **Use database indexes** for frequently queried fields
- **Use bulk operations** (`productVariantsBulkUpdate`) for multiple updates
- **Implement pagination** for large datasets
- **Add loading states** for better perceived performance

## MCP Integration

This project is configured with Shopify Dev MCP (`.mcp.json` and `.cursor/mcp.json`) for AI-assisted Shopify development. The MCP provides context about Shopify APIs and best practices.
