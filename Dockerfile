# Build TypeScript → dist, imagem final só com runtime
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev

FROM node:20-alpine

WORKDIR /app

# Copia node_modules já prunado da stage de build (evita problema de
# cross-platform com npm ci em lock files gerados no Windows)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
