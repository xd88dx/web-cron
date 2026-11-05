# web-cron —— 多功能 cron 调度器（HTTP + 真实浏览器仿真）
# 官方 Playwright 镜像已含 Chromium 与系统依赖，但不含 playwright npm 包，
# 且镜像 tag 必须与 playwright 包版本一致，否则运行时找不到浏览器可执行文件。
# 该基础镜像官方提供 linux/amd64 与 linux/arm64 两种 manifest（已用 buildx imagetools 核实）。
#
# 构建：docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t web-cron .
# 运行：docker run --init --ipc=host --shm-size=1g -p 8080:8080 -e PANEL_PASSWORD=xxx web-cron

# ---------------- 编译阶段 ----------------
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --registry="$NPM_REGISTRY"
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---------------- 运行阶段 ----------------
FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production \
    APP_TIMEZONE=Asia/Shanghai \
    DATA_DIR=/app/data \
    PORT=8080
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY package.json package-lock.json ./
# 只装生产依赖：编译产物由 build 阶段拷贝进来，devDependencies（typescript/tsx）不进最终镜像
RUN npm ci --omit=dev --registry="$NPM_REGISTRY" && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data/profiles /app/data/screenshots

EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
