# The dashboard itself: built once, then served by nginx as static files.
#
# The data tree is not in this image. It arrives in a volume that the fetch container fills, and
# nginx serves it from /usr/share/nginx/html/data.
FROM node:22-alpine AS build
WORKDIR /src
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY web/ ./
# The build also typechecks, so a broken tree cannot reach the image.
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
