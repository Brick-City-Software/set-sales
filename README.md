# Set Sales

A Shopify app that allows merchants to easily put products on sale by modifying the price and compare-at price fields.

## Features

- **Create Sales**: Set up sales with percentage off, fixed amount off, or fixed price discounts
- **Product Selection**: Browse and search products, select individual variants to include in a sale
- **Live Price Preview**: See calculated sale prices before applying
- **Sale Management**: View active and ended sales from the dashboard
- **Price Restoration**: End a sale to automatically restore original prices
- **Existing Sale Detection**: Variants already on sale are flagged and skipped

## How It Works

When a sale is applied, the app:
1. Stores the original price in the local database
2. Sets the variant's `compareAtPrice` to the original price (displayed as crossed-out)
3. Sets the variant's `price` to the calculated sale price

When a sale is ended, the app:
1. Restores the original price from the database
2. Clears the `compareAtPrice` field

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
├── shopify.server.ts           # Shopify app configuration
└── db.server.ts                # Prisma client
prisma/
├── schema.prisma               # Database schema
└── migrations/                 # Database migrations
```

## Database Schema

The app adds two models to track sales:

- **Sale**: Stores sale metadata (name, discount type/value, status)
- **SaleVariant**: Stores original and sale prices for each variant in a sale

## Deployment

### Build

```shell
npm run build
```

### Database

For production, consider switching from SQLite to a managed database. Update the `datasource` in `prisma/schema.prisma`:

| Database   | Provider     |
|------------|--------------|
| PostgreSQL | `postgresql` |
| MySQL      | `mysql`      |
| MongoDB    | `mongodb`    |

### Hosting Options

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run)
- [Fly.io](https://fly.io/docs/js/shopify/)
- [Render](https://render.com/docs/deploy-shopify-app)

Set `NODE_ENV=production` in your environment variables.

## Scopes

The app requires the following Shopify API scopes:

- `write_products` - To update product variant prices
