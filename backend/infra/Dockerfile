FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.3.0 && pnpm install --frozen-lockfile

COPY . ./
RUN pnpm prisma:generate
RUN pnpm assets:bootstrap
RUN pnpm build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV LOCAL_STORAGE_ROOT=/app/data/private
ENV KYC_ASSETS_ROOT=/app/assets
ENV KYC_ASSET_MANIFEST_PATH=/app/assets/manifest.json

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/prisma /app/prisma
COPY --from=build /app/assets /app/assets
COPY --from=build /app/package.json /app/package.json

RUN mkdir -p /app/data/private && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/src/main.js"]
