FROM node:20-alpine AS builder
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./

# Install all deps including devDependencies needed for the build
RUN npm ci && npm cache clean --force

COPY . .

RUN npm run build

# Production image — strip dev dependencies
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# Run as the unprivileged "node" user (built into the official image).
# It must own /app because docker-start runs `prisma generate`, which writes
# into node_modules.
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output and prisma schema from builder
COPY --chown=node:node --from=builder /app/build ./build
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
