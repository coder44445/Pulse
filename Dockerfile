FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./ 
COPY pulse-ui-core/package.json ./pulse-ui-core/package.json 
COPY pulse-dashboard/package.json ./pulse-dashboard/package.json

RUN pnpm install --frozen-lockfile

COPY pulse-ui-core ./pulse-ui-core 
COPY pulse-dashboard ./pulse-dashboard

ARG VITE_WS_URL ARG VITE_API_URL

ENV VITE_WS_URL=${VITE_WS_URL} 
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm build

FROM nginx:alpine AS runner

COPY --from=builder /app/pulse-dashboard/dist /usr/share/nginx/html

RUN sed -i 's/listen 80;/listen 3000;/' /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]