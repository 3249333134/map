function markersFor(items, selectedId) {
  return items.map(item => {
    const selected = item.id === selectedId
    return {
      id: item.markerId || item.id, latitude: item.latitude, longitude: item.longitude,
      iconPath: selected ? '/static/map/selected.png' : '/static/map/point.png',
      width: selected ? 32 : 24, height: selected ? 40 : 30,
      anchor: { x: 0.5, y: 1 }, zIndex: selected ? 10 : 1,
      callout: { content: item.title, display: selected ? 'ALWAYS' : 'BYCLICK', color: '#202020', bgColor: '#ffffff', fontSize: 12, padding: 8, borderRadius: 8 }
    }
  })
}
const avatarKeys = ['mika', 'sora', 'rin', 'luna', 'yuki', 'kira']
const AVATAR_POSE = { standing: 0, walkA: 1, walkB: 2, wave: 3 }
function cosplayerMarkersFor(items, selectedId, poseFor = () => AVATAR_POSE.standing) {
  return items.map((item, index) => {
    const selected = item.id === selectedId
    const key = avatarKeys.includes(item.avatar?.avatarKey) ? item.avatar.avatarKey : avatarKeys[index % avatarKeys.length]
    const pose = poseFor(item)
    const customUrl = item.avatar?.avatarUrl
    const customFrames = item.avatarFramePaths?.length > 1 || item.avatar?.avatarFrameUrls?.some(Boolean)
    const hasCustomAvatar = customFrames || (customUrl && customUrl !== `/static/avatars/${key}.png`)
    const builtInFrame = pose === AVATAR_POSE.walkA ? 1 : 0
    const iconPath = (hasCustomAvatar && (
      item.avatarFramePaths?.[pose] || item.avatarFramePaths?.[0] || item.avatarPath || customUrl
    )) || `/static/chibi/${key}-${builtInFrame}.png`
    return {
      id: item.markerId || index + 1, latitude: item.latitude, longitude: item.longitude,
      iconPath, width: selected ? 48 : 42, height: selected ? 58 : 52,
      anchor: { x: 0.5, y: 0.5 }, zIndex: item.isMine ? 1000 : selected ? 10 : 2,
      callout: { content: item.isMine ? '我的形象' : item.avatar?.nickname || '附近的 Cos', display: selected || item.isMine ? 'ALWAYS' : 'BYCLICK', color: '#202020', bgColor: '#ffffff', fontSize: 12, padding: 8, borderRadius: 12 }
    }
  }).sort((a, b) => a.zIndex - b.zIndex)
}
module.exports = { markersFor, cosplayerMarkersFor, AVATAR_POSE }
