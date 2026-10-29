function markersFor(items, selectedId) {
  return items.map(item => {
    const selected = item.id === selectedId
    return {
      id: item.id, latitude: item.latitude, longitude: item.longitude,
      iconPath: selected ? '/static/map/selected.png' : '/static/map/point.png',
      width: selected ? 32 : 24, height: selected ? 40 : 30,
      anchor: { x: 0.5, y: 1 }, zIndex: selected ? 10 : 1,
      callout: { content: item.title, display: selected ? 'ALWAYS' : 'BYCLICK', color: '#202020', bgColor: '#ffffff', fontSize: 12, padding: 8, borderRadius: 8 }
    }
  })
}
module.exports = { markersFor }
