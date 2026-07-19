FROM node:22-alpine AS build
WORKDIR /web-client
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /web-client/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Opt-in session replay: rewrites /openreplay.js at container start when
# OPENREPLAY_PROJECT_KEY is set (see the script header for the env contract).
COPY docker/30-openreplay.sh /docker-entrypoint.d/30-openreplay.sh
RUN chmod +x /docker-entrypoint.d/30-openreplay.sh
EXPOSE 80
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
