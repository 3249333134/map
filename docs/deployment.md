# 云开发部署说明

## 状态与前提

使用微信云开发**传统文档型数据库**，不使用 PostgreSQL。尚无云环境，以下部署和双用户验收未执行；本地测试通过不代表上线完成。

准备你已有的小程序 AppID、绑定的云环境、数据库及存储。创建付费资源、覆盖已有云数据、正式上传发布需要另行决定。建议先用独立测试环境，避免将存储和云函数的环境级规则覆盖到其他应用。

客户端只填写环境 ID。腾讯云密钥仅供本机初始化，放到当前进程环境变量，不能放入小程序、云函数源码、截图或 Git。

## 1. 准备

```powershell
npm ci --ignore-scripts
npm run cloud:prepare
npm test
npm run check
npm run check:wxml
```

开发者工具执行“构建 npm”。修改 `config/cloud.js`：

```js
module.exports = { envId: '你的已有环境 ID', demoMode: false }
```

项目已设置 `cloudfunctionRoot`，并从客户端打包排除云函数、deployment、脚本、测试和本机依赖。凭据不需要也不应进入配置文件。

## 2. 集合与索引

先运行 `npm run cloud:init` 查看计划，无需凭据，不连接云端。

有实际环境后，由环境管理员在本机配置 `CLOUDBASE_ENV_ID`、`TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY`；使用临时凭据时再配置 `TENCENTCLOUD_SESSIONTOKEN`，地域可用 `CLOUDBASE_REGION` 指定。不要将真实密钥粘贴进命令历史。

```powershell
npm run cloud:init -- --apply
```

只创建缺失集合和缺失索引。不删除集合、不写示例、不修改业务文档。同名索引定义不一致时停止，不删除重建。失败后修正原因再运行，已匹配索引会跳过。明细见 `deployment/database.js`，在控制台确认全部就绪后继续。

查询使用 Geo.Point + 10 公里范围、分类、时间和文档 ID 游标。模糊搜索为转义正则；首版适用于小规模内容，不依赖额外搜索服务。随数据增长观察实际耗时后再升级搜索能力。

## 3. 权限

三个规则位于 `deployment/database.rules.json`、`storage.rules.json`、`functions.rules.json`。确认目标环境及规则后执行：

```powershell
npm run cloud:init -- --apply --permissions
```

先备份当前规则到忽略提交的 `.local/permissions-*.json`，随后提交规则。**此步骤修改目标环境的存储和云函数环境级权限。** 脚本不自动回滚；失败时查备份和控制台状态再重试。共享环境应人工合并后在控制台部署，不直接执行此步骤。

业务集合全部关闭客户端直读直写，业务走 `api`。存储只允许上传者访问 `private/` 暂存文件，`sealed/` 对客户端完全关闭。服务端为公开内容签发图片临时 URL，待审图片仅作者和管理员可取。URL 不持久化，链接失效后重新加载详情。

函数规则允许微信登录环境调用 `api`，拒绝客户端调用回调和清理函数；函数内部还检查可信上下文。不要为回调和清理函数添加 HTTP 触发器。规则生效有延迟，须在客户端实测直读、直写、越权和 sealed 覆盖被拒绝。

若控制台显示 PG 模式或规则接口不支持，停止并改用传统微信云开发环境，不以开放权限绕过。

## 4. 部署三个函数

微信开发者工具选择已绑定环境，对三个目录分别执行“上传并部署：云端安装依赖”：

| 函数 | 用途 | 配置 |
| --- | --- | --- |
| api | 业务、身份、事务、文字及图片审核请求 | 60 秒超时；config.json 中两项安全 OpenAPI 权限 |
| moderationCallback | 微信异步图片审核回调 | 60 秒超时；仅平台云调用消息推送，无客户端或 HTTP 入口 |
| cleanup | 废弃图片、审核超时、取消活动通知补发 | 60 秒超时；部署 config.json 每 10 分钟定时器 |

固定 `wx-server-sdk@3.0.1`，每个函数附锁文件。共享代码自包含，不跨函数目录引用。运行时需支持 `node:crypto`、`randomUUID`、base64url（Node.js 18 或平台支持的更新版本）。

通过控制台部署仍须核实超时、OpenAPI 权限和定时器，不能仅上传 JavaScript。清理任务不删除业务内容集合。

## 5. 审核与消息推送

确认 AppID 内容安全接口可用，给 `api` 授权 `security.msgSecCheck` 和 `security.mediaCheckAsync`。将 `wxa_media_check` 事件以平台支持的**云函数消息推送**方式路由到本环境 `moderationCallback`，不是客户端 callFunction 或未验签 HTTP URL。回调读取原始 `Event`、`trace_id`、`result.suggest`。

平台入口和权限以该 AppID 后台实际可用项为准。部署后真实提交一张图片，确认 `moderationTasks` 从 waiting 到 done、媒体变 approved、内容公开。收不到事件先检查路由、环境和日志；15 分钟后内容转审核异常，作者可重试，不自动公开。

流程：私有暂存 → 服务端验证环境及每张 ≤5MB 并封存为不可覆盖副本 → 正文／地点文字审核 → 异步图片审核 → 全部通过才公开。早到回调暂存，旧回调不覆盖新审核，晚到回调不恢复已删除内容。

平台 risky 拒绝公开。review 允许管理员看全文和图片后复核；图片等待、审核错误或已拒绝时不可直接批准。作者在审核异常时重试，拒绝后通过“修改后重新发布”提交新内容与新图片，不编辑原记录。

## 6. 管理员初始化

部署 `api` 后，在目标管理员本人的微信登录会话执行：

```js
wx.cloud.callFunction({ name: 'api', data: { action: 'user.identity' } })
```

取结果 `data.id`（哈希用户 ID，不是 OPENID）。在 `api` 函数设置环境变量 `ADMIN_USER_IDS`，多位以英文逗号分隔，重新部署／重启使配置生效。

管理员保存昵称后，“我的”出现管理入口。角色仅取云端变量，客户端字段不能授权。处理写入 `audit`，普通用户不可读队列与审计。

## 7. 隐私与位置

在公众平台填写真实主体、隐私指引、联系方式、保存期限、处理渠道，核实位置接口申请及声明。用真实 AppID 验证 `getLocation`、`chooseLocation`、图片选择与微信反馈。

仅在用户主动操作时请求位置。地图出现默认使用用户主动选定的地点；也可明确选择一次当前位置并公开两小时，结束后自动从附近地图移除，不启用后台定位、不持续追踪，也不读取手机号。用户可随时手动停止。图文、Cos 昵称、角色标签和公开形象按审核结果展示，通知和个人记录按用户隔离。文字草稿在本机，图片草稿不跨次恢复。

删除或下架后不可公开访问，24 小时后清理相关媒体。已签发临时 URL 到期前可能有效。报名、通知、举报与审计不自动销毁；上线前按真实保存政策补充运营流程。

## 8. 恢复与验收

| 现象 | 处理 |
| --- | --- |
| 尚未配置环境 | 填 ID，确认 demoMode 为 false，重新编译 |
| 云连接失败 | 检查网络、环境绑定、api 部署及规则，再重试 |
| 服务暂不可用 | 查 api 日志中的操作，核实集合、索引、SDK、OpenAPI 权限 |
| 审核长时间无结果 | 核实回调和定时器；超时后作者重试 |
| 上传失败 | 留在发布页重试；成功图片复用，退出仅保留文字草稿 |
| 活动已满／开始／取消 | 不可新报名，可查看状态；已报名者仍能取消报名 |
| 来源已删除 | 详情明确提示，返回原列表；消息仍可标已读 |
| 初始化中断 | 检查控制台状态再执行，不替换已有索引或自动回滚权限 |

按 [完整验收表](acceptance.md) 做两用户和真机验收。模拟数据库不代表云事务、审核回调、安全规则或设备操作已通过。

官方依据：[身份](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)、[事务](https://docs.cloudbase.net/database/transaction)、[集合与索引](https://docs.cloudbase.net/api-reference/manager/node/database)、[规则接口](https://docs.cloudbase.net/en/api-reference/manager/node/rule)、[存储规则](https://docs.cloudbase.net/storage/security-rules)。
