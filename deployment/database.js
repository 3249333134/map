// 微信云开发传统文档型数据库；不适用于 PostgreSQL 环境。
const { TABLES } = require('../cloudfunctions/api/lib/service')
const page = [['createdAt', '-1'], ['_id', '-1']]
const index = (name, keys) => ({ IndexName: name, MgoKeySchema: { MgoIsUnique: false, MgoIndexKeys: keys.map(([Name, Direction]) => ({ Name, Direction })) } })
const indexes = Object.fromEntries(TABLES.map(name => [name, [index('created_page', page)]]))
indexes.contents.push(
  index('feed', [['status', '1'], ['kind', '1'], ...page]),
  index('feed_category', [['status', '1'], ['kind', '1'], ['category', '1'], ...page]),
  index('nearby', [['location', '2dsphere'], ['status', '1'], ['kind', '1'], ...page]),
  index('nearby_category', [['location', '2dsphere'], ['status', '1'], ['kind', '1'], ['category', '1'], ...page]),
  index('owner_kind', [['ownerId', '1'], ['kind', '1'], ['status', '1'], ...page]),
  index('review_queue', [['status', '1'], ...page]),
  index('cancel_notices', [['kind', '1'], ['cancelled', '1'], ['noticesDone', '1'], ...page])
)
indexes.comments.push(index('content_comments', [['targetId', '1'], ['status', '1'], ...page]))
for (const table of ['reactions', 'favorites', 'members']) indexes[table].push(index('owner_active', [['ownerId', '1'], ['active', '1'], ...page]))
indexes.members.push(index('activity_members', [['targetId', '1'], ['active', '1'], ...page]))
indexes.notifications.push(index('inbox', [['ownerId', '1'], ...page]), index('unread', [['ownerId', '1'], ['read', '1'], ...page]))
indexes.reports.push(index('report_queue', [['status', '1'], ...page]))
indexes.users.push(index('avatar_media', [['avatarMediaId', '1']]), index('avatar_pending_media', [['avatarPendingMediaId', '1']]))
indexes.presences.push(index('nearby_presence', [['location', '2dsphere'], ['active', '1'], ['expiresAt', '1']]), index('presence_owner', [['ownerId', '1']]))
indexes.friendships.push(index('friend_list', [['ownerId', '1'], ['status', '1'], ...page]), index('friend_target', [['targetId', '1'], ['status', '1'], ...page]))
module.exports = { collections: TABLES, indexes }
