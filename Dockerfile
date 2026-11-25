# Пукоплот — игровой сервер (Bun + PostgreSQL через Bun.SQL)
FROM oven/bun:1.2-alpine
WORKDIR /app
COPY server.mjs store.mjs ./
COPY public ./public
ENV PORT=3000 DATA_DIR=/data NO_BROWSER=1
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["bun", "server.mjs"]
