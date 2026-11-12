# 数据与接口

客户端只走 `utils/api.js`，请求 `{ action, input }`，返回 `{ ok: true, data }` 或 `{ ok: false, code, message }`。云错误不切换假数据。显式演示模式仅只读。

用户 ID 为可信 OPENID 的 SHA256 前 32 位。内容、互动、报名与通知使用字符串主键；地图独立映射稳定数字 ID。示例不导入正式集合。时间为服务端毫秒时间戳。

列表每页 20 条，排序 `createdAt desc, _id desc`；游标为二者的 base64url 编码。搜索改变须重置游标，满页会返回下一游标，末尾可能再取一次空页。未读数上限 99。

## 集合

所有集合 `_id` 是字符串，`createdAt` 是时间。索引明细在 `deployment/database.js`，确定性主键保证唯一性。

| 集合 | 字段与用途 |
| --- | --- |
| users | nickname、avatarKey、avatarMediaId、avatarPendingMediaId、avatarReviewStatus、tags、blocked；昵称／标签经审核，头像审核通过后公开 |
| contents | ownerId、kind、title、text、category、place、latitude/longitude、location(Geo.Point)、searchText、mediaIds；status、textApproved、textVerdict、moderationError；likes、commentCount；活动加 startAt/endAt、capacity、joinedCount、cancelled、noticeCursor、noticesDone |
| comments | ownerId、targetId、nickname、text、status；主键绑定用户与 requestId |
| reactions / favorites | ownerId、targetId、active；用户与内容构成主键 |
| members | ownerId、targetId、active、version；报名版本对应通知 |
| notifications | ownerId(接收者)、actorId、type、targetId、read；like/comment/signup/withdraw/activity_cancel |
| reports | ownerId、targetId、reason、status(open/closed)、decision；每用户每内容一条 |
| media | ownerId、cloudPath、fileId(封存)、originalFileId、stagedFiles、status、targetId、traceId、checkingAt、token；不持久化 URL |
| moderationTasks | 主键为 traceId；内容图片用 mediaId/targetId，Cos 头像用 mediaId/userId/type(profile_avatar)，status(early/waiting/done)、suggest、completedAt |
| audit | actorId、targetId、decision；管理员处理记录 |
| limits | 用户每天发布／上传计数，清理扫描游标 |
| presences | ownerId、location(Geo.Point)、latitude/longitude、place、mode(place/current)、shout、active、updatedAt、expiresAt；用户主动设置的短时地图出现，默认两小时过期 |
| friendships | ownerId、targetId、status(pending/accepted/declined)、version；方向记录通过好友申请后成对建立 |

内容：pending → published / review / rejected / review_error，删除为 deleted。review 由管理员复核，review_error 作者重试，rejected 需改后新发布。活动取消用 cancelled，保留历史。

媒体：reserved → sealing → ready → pending → checking → approved / review / rejected；清理先锁为 deleting，再 deleted。发布绑定与清理互斥；超时不能自动公开。

## 操作

| action | input | 权限与约定 |
| --- | --- | --- |
| feed | kind、query、category、center{latitude,longitude}、cursor | 公开，10 公里范围，分页 |
| content.get | id | 公开／作者／管理员；补齐昵称、图片 URL、本人互动状态 |
| user.identity | 无 | 本人哈希 ID，不依赖用户文档 |
| user.me | 无 | 本人资料及 isAdmin，未建资料为 null |
| user.save | nickname、avatarKey、tags、avatarMediaId(选填) | 文字审核通过才保存；上传头像走现有图片审核回调，通过后才替换公开头像 |
| presence.nearby | center{latitude,longitude} | 公开读取十公里内 active 且未过期的 Cos 地图状态，不持续跟踪位置 |
| presence.me / presence.set / presence.off | set 接收 place、latitude/longitude、mode(place/current)、shout | 本人；显式开启或关闭，服务端两小时自动过期 |
| friend.request | userId | 有昵称；重复申请幂等，互相待处理时直接成为好友 |
| friend.respond | userId、accept(boolean) | 本人作为接收方处理待处理申请 |
| friends.list | cursor | 本人已接受好友列表 |
| content.create | requestId、kind、title、text、category、place、latitude/longitude、mediaIds；活动加 startAt/endAt/capacity | 有昵称，每天 ≤30 次；本人 ready 图片；同 requestId 同内容 |
| content.reviewRetry | id | 作者重试异常审核，不修改正文 |
| content.remove | id | 作者动态软删除 |
| activity.cancel | id | 发起人取消；分页通知，不重复 |
| comments.list | id、cursor | 公开内容的公开评论 |
| comment.create | id、text、requestId | 有昵称，文字审核，事务更新计数及通知 |
| like.set / favorite.set | id、active(boolean) | 有昵称，显式目标状态，幂等 |
| activity.signup | id、active(boolean) | 有昵称；非发起人；事务验容量与时间，退出释放名额 |
| mine | section(posts/activities/joined/favorites)、cursor | 本人；失效来源隐藏，游标继续前进 |
| notifications.list / unread | cursor（仅 list） | 本人，可未建昵称；好友申请通知可同意或忽略 |
| notifications.read | id | 本人接收的通知 |
| report.create | id、reason | 有昵称，公开内容，幂等 |
| media.reserve | 无 | 有昵称，每天 ≤100 张，返回 id/cloudPath |
| media.complete | id、fileId | 核验归属、路径、环境、≤5MB；服务端封存，完成可重试 |
| admin.list | cursor、reportCursor、skipContents、skipReports | 云端管理员，队列各自分页 |
| admin.resolve | id、reportId(选填)、decision(approve/reject/hide/dismiss)、note(选填) | 管理员；批准需平台待复核且图片已审核；写 audit；可结案已删除来源举报 |

客户端传 ownerId、openid、isAdmin、likes、status、joinedCount 不授予身份或写入计数。服务端取可信上下文并重验权限。活动、点赞、收藏及通知用事务；评论与发布用 requestId 去重，重试不能改写原正文。

取消活动即时通知一页报名者，其余由定时器补齐。列表非实时订阅，进入消息／活动／个人页会刷新；首页发布后返回或主动加载更新。不请求订阅消息。

回调与定时器没有客户端入口，须按部署说明完成实际平台路由与验收。
