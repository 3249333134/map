# 附近 · 地图社交微信小程序

微信原生小程序 + TDesign + 微信云开发。沉浸式 Cos 地图展示附近角色形象，支持选点／短时当前位置、附近喊话、好友申请；保留地图动态、活动和原有两档底部面板。

| 入口 | 已实现的代码 |
| --- | --- |
| 首页 | Cos 形象地图、附近喊话与好友申请；可切换地图动态、搜索与分类、区域查询、分页、图文详情、点赞、评论、收藏、举报、分享 |
| 服务 | 附近活动、活动详情、即时报名与取消、容量检查、发起人取消 |
| ＋ | 动态／活动切换、文字草稿、最多九图、压缩上传与进度、地点、审核状态、失败重试 |
| 消息 | 好友申请与内容互动通知、未读数量、好友同意／忽略、跳转来源 |
| 我的 | Cos 昵称、内置形象、云端 AI 生成原创动漫形象、兴趣标签、主动开关地图出现、选定地点或一次性当前位置、好友与内容记录 |

动漫形象使用服务端调用 Agnes AI Images API 生成 2×2 像素动作图集；可按 IP 与角色名生成，也可上传参考图。服务端切出四帧步行动作，地图按帧播放。API 密钥只配置在运行生成服务的电脑上，不进入小程序。没有自定义头像时使用本地像素小人。

不包含视频、私聊、手机号、支付、订单或商家系统。发布后支持删除动态或取消活动，不支持原地编辑。

## 先运行

1. 微信开发者工具导入本目录，核实 `project.config.json` 中 AppID 的使用权限。
2. 已保留构建的 `miniprogram_npm`。全新安装运行 `npm ci --ignore-scripts`，再在开发者工具选择“工具 → 构建 npm”。
3. 按 [部署说明](docs/deployment.md) 初始化已有云环境、部署三个云函数及权限，然后填写 `config/cloud.js` 的 `envId`。
4. 编译。仓库默认开启 `demoMode`，不需要云环境即可完整体验：发布、点赞、收藏、评论、报名、好友申请、消息处理、资料编辑、地图出现都在本地演示数据上真实写入，数据只保存在开发者工具缓存（`utils/demo-store.js`）。接入云环境时把 `config/cloud.js` 的 `demoMode` 改为 `false` 并填写 `envId`。

### 启动动漫形象生成服务

需要 Agnes AI API 密钥和本机生成服务。把密钥保存在项目根目录的 `.env.local`（此文件已加入 `.gitignore`）：

```bash
AGNES_API_KEY=你的 API 密钥
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
```

然后启动服务：

```bash
npm run avatar-server
```

服务监听 `http://127.0.0.1:8765`。本地测试使用开发者工具模拟器；真机调试需要配置可从手机访问的服务地址。生成会产生图像 API 用量费用。Agnes 图像接口参数见[模型目录](https://github.com/AgnesAI-Labs/skills/blob/main/agnes-ai-models/references/model_catalog.md)。

**当前交付是代码与部署工具，尚未连接真实云环境或发布上线。** 两个真实用户、平台审核回调和 iOS／Android 真机操作需要环境准备好后按验收表执行。

## 开发与验证

```powershell
npm test
npm run cloud:prepare
npm run check
npm run check:wxml
npm run cloud:init
```

最后一项默认只展示初始化计划，不连接云端。WXML 检查需要本机微信开发者工具；安装路径不同时，设置 `WXML_COMPILER` 为其 `wcc.exe` 完整路径。

开发者工具开启自动化端口并打开地图首页后，可运行 `npm run smoke` 验证真实编译后的面板，步骤见 [运行时验收](docs/acceptance.md)。自动测试使用隔离的内存数据库，不替代云端事务与真机验收。

## 项目结构

```text
pages/              地图、活动、发布、消息、我的、详情、隐私、管理页
components/         统一内容卡、底栏
utils/              数据访问、导航、面板、标记映射
config/cloud.js     客户端环境 ID、演示开关与本地形象服务地址（不放密钥）
data/demo.js        演示种子内容
utils/demo-store.js 本地演示数据层（可读写的演示流程）
cloudfunctions/     api、moderationCallback、cleanup（排除在客户端包外）
deployment/         集合索引、数据库／存储／云函数权限
scripts/            检查、同步云函数、非破坏式初始化、运行时检查
server/             StyleGAN2 + StyleFlow + AnimeGANv3 本地推理服务（Python，权重不入库）
tests/              原有 28 项回归与新增业务／安全检查
```

共享代码只编辑 `cloudfunctions/api/lib`，部署前执行 `npm run cloud:prepare` 同步到其余函数。[接口与数据说明](docs/data-api.md) 记录集合字段和操作约定。

UI 使用 [TDesign 微信小程序组件库](https://github.com/Tencent/tdesign-miniprogram) `1.17.0`，遵循 MIT 协议。参考项目 `D:/prj/map_qh_xy/map_q` 未修改。
