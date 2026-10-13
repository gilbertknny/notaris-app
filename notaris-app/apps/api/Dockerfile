# Build dari root monorepo:  docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @notaris/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @notaris/shared build && pnpm --filter @notaris/api build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/db ./apps/api/db
COPY --from=build /repo/apps/api/package.json ./apps/api/
WORKDIR /repo/apps/api
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
