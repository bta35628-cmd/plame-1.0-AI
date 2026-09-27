FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install --omit=dev

COPY . .

ENV PORT=10000
ENV CHAT_UPSTREAM_URL=https://cj2api.keh5.workers.dev/v1/chat/completions
ENV IMAGE_UPSTREAM_URL=https://image.pollinations.ai

EXPOSE 10000

CMD ["node", "index.js"]
