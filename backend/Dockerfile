# Build from the repository root:  docker build -f backend/Dockerfile -t dsa-squad-api .
FROM node:22-alpine
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY database /app/database
EXPOSE 5000
USER node
CMD ["npm", "start"]
