FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

EXPOSE 3000

CMD ["npm", "start"]
