<div align="center">
  <img src="frontend/public/logo.png" width=256></img>
  <p><strong>Rust SQLite WebUI - 一个极致轻量的 SQLite Web 管理工具</strong></p>
  
  [English](README.md) | 简体中文
  
</div>

# SQLite WebUI

基于 Rust (Axum) 和 Solid.js 的 **极致轻量** SQLite Web 管理工具。

- 🐳 **极致轻量**: Docker 镜像大小仅 **~10MB**。
- ⚡ **高性能**: 运行时内存占用仅 **~1MB**。
- 🤖 **AI 辅助**: 智能纠正错误 SQL，支持自然语言转 SQL。

![介绍](instruction.jpg)

![截图](screenshot.png)

## 技术栈

- **后端**: Rust, Axum, SQLx, Tokio
- **前端**: Solid.js, Vite, TailwindCSS, DaisyUI

## 使用说明

推荐使用 Docker 运行本项目。

### Docker Run

```bash
docker run -d \
  -p 3000:3000 \
  -v sqlite.db:/app/db/sqlite.db \
  -e API_KEY=your_secret_key \
  --name sqlite-webui \
  wangyucode/rust-sqlite-webui
```

### Docker Compose

```yaml
version: '3'
services:
  sqlite-webui:
    image: wangyucode/rust-sqlite-webui
    ports:
      - "3000:3000"
    volumes:
      - sqlite.db:/app/db/sqlite.db
    environment:
      - API_KEY=your_secret_key
```

### 配置

- **DB files**: 数据库文件会在 `DB_DIR` 指定的目录下递归扫描（默认值为 `db`，在 Docker 中即 `/app/db`）。支持子目录路径（例如 `rust/sqlite.db`），可用于 Docker 卷挂载如 `./rust/data/db:/app/db/rust`。

- **环境变量**:
| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| API_KEY | `your-super-secure-key` | 用于访问 WebUI 的认证密钥。|
| DB_DIR | `db`（在 Docker 中为 `/app/db`） | 用于发现和存储 SQLite 数据库文件的目录。|
| RUST_LOG | `rust_sqlite_webui=debug,tower_http=debug` | 日志级别配置。|
| OPENAI_API_KEY | - | OpenAI API 密钥（AI 辅助功能必需）。|
| OPENAI_BASE_URL | `https://api.openai.com/v1` | OpenAI API 地址。|
| OPENAI_MODEL | `gpt-5.4-mini` | OpenAI 模型名称。|

要在 Docker 中使用其他数据库目录，请设置 `DB_DIR` 并将数据卷挂载到相同路径，例如 `-e DB_DIR=/data -v $(pwd)/data:/data`。

> **提示**: 开发环境下可在 `backend/` 目录创建 `.env` 文件配置上述变量。

## 开发指南

### 1. 启动前端开发服务器

需要安装 Node.js (v18+)。

```bash
cd frontend
pnpm install
pnpm start
```

前端服务默认运行在 `http://localhost:5173`。

### 2. 启动后端 API 服务

需要安装 Rust (cargo)。

```bash
cd backend
cargo run
```

后端服务运行在 `http://localhost:3000`。

### 3. 构建发布

**构建前端**:
```bash
cd frontend
pnpm build
```
构建产物位于 `frontend/dist`。

**构建后端**:
```bash
cd backend
cargo build --release
```

后端发布二进制文件位于 `backend/target/release`。

## 文档

详细设计文档请参考 [doc/design_CN.md](doc/design_CN.md)。
