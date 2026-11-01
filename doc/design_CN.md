[English](design.md) | [简体中文]

# crablite 设计方案

## 1. 项目概述

本项目旨在构建一个基于 Rust + SolidJS 的 SQLite 数据库管理工具，追求极致的简洁与轻量。用户可以通过浏览器直接管理本地的 SQLite 数据库文件，执行 SQL 查询，查看和编辑数据。

**核心目标**:
- **轻量级**: 单二进制文件分发，启动即用。Docker 镜像仅 **~6.5MB**。
- **高性能**: 运行时内存占用仅 **~700KB**。能够流畅处理大量数据的展示。
- **简洁易用**: UI 设计基于 "Less is More" 原则，专注于核心 SQL 操作。

## 2. 技术栈架构 (方案 A)

### 2.1 后端 (Rust)
- **Web 框架**: `Axum` - 高性能、人体工学极佳的异步 Web 框架。
- **运行时**: `Tokio` - Rust 异步生态的标准。
- **数据库交互**: `SQLx` - 纯 Rust 实现的异步 SQL 驱动，支持连接池。
- **序列化**: `Serde` + `Serde JSON` - 处理前后端数据交换。

### 2.2 前端 (Modern Web)
- **框架**: `Solid.js` - 高性能响应式框架，无虚拟 DOM。
- **构建工具**: `Vite` - 极速开发服务器和构建工具。
- **UI 框架**: `TailwindCSS` + `DaisyUI` - 实用优先的 CSS 框架及语义化组件库。

## 3. 系统架构设计

### 3.1 整体架构
采用前后端分离架构，但在生产环境中，前端静态资源将嵌入到 Rust 二进制文件中，通过 Axum 提供的 Static File 服务进行分发，实现“单文件部署”。

```mermaid
graph TD
    User[用户浏览器] <--> |HTTP/WebSocket| Backend[Rust Axum Server]
    Backend <--> |SQLx| SQLite[SQLite DB File]
    Backend --> |Serve| Static[前端静态资源 - SolidJS构建产物]
```

### 3.2 目录结构规划
```text
crablite/
├── backend/            # 后端源码 (Rust)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs     # 入口与路由
│       ├── state.rs    # 全局状态
│       └── handlers/   # API 处理器
│           ├── mod.rs
│           ├── connection.rs
│           ├── query.rs
│           └── health.rs
├── frontend/           # 前端源码 (SolidJS)
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx     # 根组件
│       ├── lib/        # 逻辑与 API 客户端
│       └── components/ # UI 组件
└── doc/                # 文档
```

## 4. 核心功能模块与 API 设计

### 4.1 连接管理
管理 SQLite 数据库连接。
- **API**:
  - `POST /api/connect`: 连接到本地 SQLite 文件。
    - **Request**: `{ "path": "test.db", "create": true }`
  - `GET /api/db-files`: 列出 `DB_DIR` 目录下的可用数据库文件（默认为 `./db`）。
  - `GET /api/health`: 健康检查。

### 4.2 数据库元数据
通过只读的 Schema Explorer 展示数据库结构。

**Schema Explorer 范围与导航**：
- **Table Schema**：展示列（包括隐藏列和生成列）、声明类型、空值约束、默认值、主键位置、外键、索引列/排序规则/方向、触发器，以及原始 `CREATE TABLE` SQL。
- **Database Schema**：浏览用户定义的表、视图、索引和触发器，查看对象保存的 SQL，并复制组合后的用户 Schema DDL。自动索引等没有保存 SQL 的对象不会包含在组合 DDL 中。
- **SQLite Internals**：展示精选的数据库、连接和引擎元数据，以及全部 `main.sqlite_schema` 条目，并可筛选通常隐藏的 `sqlite_%` 对象。不常用的 PRAGMA 仍可通过 SQL 编辑器查询。
- **导航**：点击表仍然浏览数据行；独立的 Schema 操作打开表详情、数据库 Schema 和 Internals 视图。小屏幕使用表选择器和操作按钮替代隐藏的侧栏。
- **刷新行为**：表、视图、索引或触发器的 `CREATE`、`DROP`、`ALTER` 成功后，刷新表列表和当前元数据视图。对象仍存在时保留选择，已删除时返回数据库概览；切换数据库会清空全部元数据状态。

**API**：
- `GET /api/tables`：获取当前连接中的用户表名。
- `GET /api/schema`：返回 `{ "objects": [...], "ddl": "..." }`，包含用户对象和组合 DDL。
- `GET /api/schema/table?name=<table>`：返回单个表的完整类型化 Schema。表名使用绑定参数，支持引号及特殊字符；表不存在时返回 `404`。
- `GET /api/internals`：返回 `{ "database": [...], "connection": [...], "engine": [...], "schema_entries": [...] }`。

所有元数据端点均使用现有 `x-api-key` 认证，并且只检查 `main` 数据库。`PRAGMA database_list` 会列出附加数据库，但不会浏览其对象。表详情通过 SQLite 表值 PRAGMA 函数绑定标识符，避免将表名插值到 PRAGMA 语句中。

Internals 的精选内容包括：
- **数据库**：`database_list`、`page_size`、`page_count`、`freelist_count`、`journal_mode`、`encoding`、`user_version`、`schema_version`、`application_id`、`auto_vacuum`。
- **连接**：处理当前请求的连接上的 `foreign_keys`、`busy_timeout`、`synchronous`、`cache_size`。
- **引擎**：`sqlite_version()` 和 `compile_options`。

### 4.3 SQL 执行器
核心功能，用于执行用户输入的 SQL。
- **API**:
  - `POST /api/query`: 执行 SQL 语句。
    - **Request**: `{ "sql": "SELECT * FROM users LIMIT 100" }`
    - **Response**: 
      ```json
      {
        "columns": ["id", "name"],
        "column_types": ["INTEGER", "TEXT"],
        "rows": [[1, "Alice"], [2, "Bob"]],
        "affected_rows": null,
        "execution_time": 12.5,
        "error": null
      }
      ```

### 4.4 API 安全
实施了基本的安全措施以保护接口。
- **认证**: 所有 API 请求（除健康检查外）都需要 `x-api-key` 请求头。
  - 密钥通过 `API_KEY` 环境变量设置。
  - 默认值: `your-super-secure-key`。
- **文件访问控制**: 数据库文件仅限于 `DB_DIR` 目录（默认为 `./db`）。已阻止目录遍历（例如 `../`）。

## 5. UI/UX 设计草图

界面布局采用经典的 **单页面布局**：

*   **Header**: 顶部栏，包含 Logo、当前数据库路径，支持下拉框选择历史连接、新建数据库按钮。
*   **Sidebar (左侧)**: 数据库对象浏览器。
    *   **Tables**: 列表展示所有表名，每个表名旁有删除按钮。
    *   **Add Table**: 按钮用于添加新表。
    *   点击表名可以生成 `SELECT` 语句并快速预览数据。
*   **Main Content (右侧)**: 选项卡式工作区。
    *   **SQL Editor**: 始终位于 Query、Database Schema 和 SQLite Internals 工作区上方。
    *   **Query**: 提供 SQL 执行、选中行增删改操作和紧凑型结果表格。
    *   **Schema Explorer**: 通过对象导航和详情视图展示表定义、数据库对象、组合 DDL 与 SQLite Internals。

**Material 3 主题风格**：
- 在现有 Tailwind CSS 与 DaisyUI 层上应用 Material Design 3 的 Surface、色调、导航、按钮、对话框和紧凑数据模式，不引入新的 UI 框架。
- 使用由 Rust 橙色派生的 OKLCH 色阶，提供可显式切换的浅色和深色主题，并将选择保存到 `localStorage`。
- 主要操作使用标准尺寸控件，Schema 和结果表保持紧凑，同时提供可访问的焦点状态与减少动画支持。
- 本地打包拉丁字符集 Roboto 字重和实际使用的 Material Symbol SVG，避免运行时 CDN 依赖及完整数 MB 图标字体。