# DOCTAR API — Node.js + TypeScript + MongoDB
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY patches ./patches
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY fonts ./fonts
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY patches ./patches
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY fonts ./fonts
EXPOSE 8000
CMD ["node", "dist/server.js"]
