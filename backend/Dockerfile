FROM node:22-slim AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /backend

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build
RUN install -D src/services/oui/oui_data.gz dist/src/services/oui/oui_data.gz

ENV NODE_ENV=production

EXPOSE 8060

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s \
  CMD node -e "require('http').get('http://localhost:8060/ping', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Tagged/Kubernetes images run compiled JavaScript. Prisma and tsx remain in
# the image because the Kubernetes schema init container and local Compose
# development override invoke them from this same image.
CMD ["node", "dist/src/index.js"]
