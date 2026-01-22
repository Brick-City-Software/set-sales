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
- `app.tsx` - App shell layout (authenticated routes)
- `app.sales._index.tsx` - Sales dashboard at `/app/sales`
- `app.sales.new.tsx` - Create new sale at `/app/sales/new`
- `app.sales.$saleId.tsx` - Sale detail page at `/app/sales/:saleId`
- `auth.$.tsx` - Catch-all auth routes at `/auth/*`
- `webhooks.app.uninstalled.tsx` - Webhook handler for `app/uninstalled` topic
- `_index/route.tsx` - Public landing page at `/`

### Server-Side Code Convention

Files ending in `.server.ts` or `.server.tsx` are Node-only and not bundled into the client:
- `app/shopify.server.ts` - Shopify app configuration and authentication
- `app/db.server.ts` - Prisma client singleton

### Key Integrations

**Authentication**: All `/app/*` routes require authentication via `authenticate.admin(request)` from `shopify.server.ts`. Use `redirect` from `authenticate.admin`, not from `react-router`.

**GraphQL**: Use `admin.graphql()` for Admin API queries. API version is October 2025.

**UI Components**: Uses Polaris web components (native HTML custom elements like `<s-page>`, `<s-button>`), not React Polaris.

**Database**: Prisma with SQLite (`prisma/dev.sqlite`). Models include:
- `Session` - Shopify OAuth tokens and shop data
- `Sale` - Sale metadata (name, discount type/value, status)
- `SaleVariant` - Original and sale prices for each variant in a sale

### Webhook Handling

Webhooks are configured in `shopify.app.toml` and handled by route files matching the pattern `webhooks.{topic}.tsx`. The topic `app/uninstalled` maps to file `webhooks.app.uninstalled.tsx`.

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

## MCP Integration

This project is configured with Shopify Dev MCP (`.mcp.json` and `.cursor/mcp.json`) for AI-assisted Shopify development. The MCP provides context about Shopify APIs and best practices.
