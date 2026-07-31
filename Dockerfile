FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4100
ENV HOST=0.0.0.0

EXPOSE 4100

CMD ["npm", "start"]
