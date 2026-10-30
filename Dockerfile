FROM node:24-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund --registry=https://registry.npmjs.org
COPY web ./web
COPY server/site-icons.json ./server/site-icons.json
COPY vite.config.mjs ./
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/app/data UPDATE_STATE_DIR=/app/updates
WORKDIR /app
COPY --from=build --chown=node:node /build/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node package.json ./package.json
RUN chmod -R a+rX /app/server /app/dist && chmod a+r /app/package.json && mkdir -p /app/data /app/updates && chown node:node /app/data /app/updates
USER node
EXPOSE 8787
VOLUME ["/app/data", "/app/updates"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
