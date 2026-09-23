FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

# High scores live in /app/data/leaderboard.json. Mount a volume there (or set
# LEADERBOARD_FILE to a mounted path) or they reset on every redeploy.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node

EXPOSE 3000

CMD ["npm", "start"]
