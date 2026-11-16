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
function cosplayerMarkersFor(items, selectedId, frame = 0) {
  return items.map((item, index) => {
    const selected = item.id === selectedId
    const key = avatarKeys.includes(item.avatar?.avatarKey) ? item.avatar.avatarKey : avatarKeys[index % avatarKeys.length]
    return {
      id: item.markerId || index + 1, latitude: item.latitude, longitude: item.longitude,
      iconPath: item.avatarFramePaths?.[frame] || item.avatarPath || item.avatar?.avatarUrl || `/static/chibi/${key}-${frame}.png`, width: selected ? 48 : 42, height: selected ? 58 : 52,
      anchor: { x: 0.5, y: 0.5 }, zIndex: selected ? 10 : 2,
      callout: { content: item.avatar?.nickname || '附近的 Cos', display: selected ? 'ALWAYS' : 'BYCLICK', color: '#202020', bgColor: '#ffffff', fontSize: 12, padding: 8, borderRadius: 12 }
    }
  })
}
module.exports = { markersFor, cosplayerMarkersFor }
