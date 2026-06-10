FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=8090

USER node

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8090/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
