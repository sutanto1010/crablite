# Stage 1: Build Frontend
FROM node:24-alpine AS frontend-builder
WORKDIR /app
# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY frontend/package.json frontend/pnpm-lock.yaml ./
# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code and build
COPY frontend/ .
RUN pnpm build

# Stage 2: Build Backend
FROM rust:alpine AS backend-builder
WORKDIR /app
# Install musl-dev for static linking
RUN apk add --no-cache musl-dev

# Create a dummy project to cache dependencies
RUN cargo new backend
WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
# Build dependencies only
RUN cargo build --release

# Copy actual source code
COPY backend/src ./src
# Touch main.rs to force rebuild of the application
# Remove the fingerprint of the dummy build to ensure full rebuild of the bin
RUN touch src/main.rs
ARG APP_VERSION
RUN APP_VERSION=${APP_VERSION} cargo build --release

# Stage 3: Runtime
FROM alpine:latest
WORKDIR /app
# Install necessary runtime dependencies (if any)
RUN apk add --no-cache ca-certificates tzdata

# Copy backend binary
COPY --from=backend-builder /app/backend/target/release/crablite .

# Copy frontend assets
COPY --from=frontend-builder /app/dist ./dist

# Environment variables
ENV RUST_LOG=info
ENV PORT=3000

EXPOSE 3000

CMD ["./crablite"]
