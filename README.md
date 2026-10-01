# 天文观测计划编排台（gbobsplan）

面向业余天文台与高校天文社团的值班排期人员：把「观测目标—可见窗口—月相—望远镜与终端—备用观测夜」串成一份可执行的观测夜编排表，解决目标亮度与月相冲突、设备被重复占用、阴天临时改期难以追溯的问题。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21813>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | MUI（Material UI 5）+ Emotion |
| 路由 | React Router 6（5 条业务路由 + 404） |
| 状态 | Zustand（targetStore / sessionStore / equipmentStore / nightStore / maintenanceStore） |
| 存储 | IndexedDB（Dexie，库名 `gbobsplan-db`，`schemaVersion` + v2/v3 迁移） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21813
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # target / session / equipment / night / maintenance（+ index.ts 统一出口）
│       ├── stores/            # targetStore / sessionStore / equipmentStore / nightStore / maintenanceStore
│       ├── components/common/ # Timeline / StatusChip / ConflictBadge / FieldRow
│       ├── hooks/             # usePersistentStore（Dexie 读写 + Zustand 同步）/ useConflictCheck / useMaintenanceConflicts
│       ├── pages/             # OverviewPage / TargetsPage / SessionsPage / EquipmentPage / ExportPage
│       ├── router/index.tsx   # 路由表
│       └── utils/             # astro.ts（高度角/可见窗口/月相）/ export.ts / id.ts / maintenanceBulletin.ts（维护组通告夹具）/ fingerprint.ts
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 本夜编排总览 | 30 分钟刻度时间轴 + 月相与月出月落条带；冲突与低于高度阈值的目标自动标灰 |
| `/targets` | 观测目标库 | 按类型与优先级筛选、按视星等排序、维护地平高度阈值与曝光参数，并给出本夜可见窗口 |
| `/sessions` | 排程段与冲突 | 冲突检测结果、按时段/望远镜校验，勾选多条批量改期到备用观测夜并填写改期原因 |
| `/equipment` | 设备分配视图 | 行 = 望远镜、列 = 30 分钟时段；排程互撞标红、维修窗口橙色斜纹叠加、双方牵制格描紫边；维护组通告对账与值班人裁定台均在本页 |
| `/export` | 导出观测清单 | 目标、时刻、滤镜、帧数导出为文本与 CSV，支持打印视图 |

## 编排台 × 维护组：数据归属与对账边界

- **夜里排什么目标由编排台定（`sessions`），望远镜哪几天进维护由维护组登记（`maintenanceWindows`）**：两侧数据分表持有，谁也不替对面改——`maintenanceStore` 只写维修窗口/裁定，绝不写排程段；通告窗口在编排端只读、不可撤回。
- **通告没读进来时先留着编排台当天改过的排程**；首次对账必然失败一次（见 `utils/maintenanceBulletin.ts` 夹具），点「重试读入」只补维护组那一侧（按窗口 ID 覆盖 upsert，本机登记窗口保留），并以排程段 FNV-1a 指纹校验编排侧未变。
- **两边互相牵制（排程段 ⨯ 同望远镜同时段停机窗口）摆到设备分配视图的裁定台上等值班人裁定**：裁定只写 `rulings` 留痕，不回写任一方原始数据；「编排优先」给出「去改期」入口，走既有批量改期到备用夜流程。
- **做完的段不动**：`已完成` 排程段与停机窗口重叠时标记「已完成段·锁定」，只留痕、不可改期。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbobsplan-db`），表：`targets`、`sessions`、`telescopes`、`instruments`、`nights`、`maintenanceWindows`、`rulings`、`meta`。
- `db.version(1).stores({...})` 声明索引；`db.version(2).upgrade(...)` 为排程段增加 `backupNightId` 索引，并给旧数据补齐 `schemaVersion` 与因云取消排程段的替补夜；`db.version(3)` 新增维修窗口与值班裁定两张表，旧库排程段只刷新 `schemaVersion`，已完成段不动。
- 首次打开且表为空时写入示例数据（12 个观测目标、5 个观测夜、4 台望远镜、4 台终端、14 段排程，含 1 处设备冲突与 1 条改期记录；另有 1 条维护组本机登记窗口）。5 条维护组通告窗口需在设备分配视图点「读入维护组通告」后写入（首次失败、重试成功，含 4 处排程 × 维修牵制，其中 1 处为已完成段锁定）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
