// Publish the center of a roughly 500 m grid cell instead of raw GPS coordinates.
function blurLocation(latitude, longitude, cellMeters = 500) {
  const latStep = cellMeters / 111320
  const lonStep = cellMeters / (111320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)))
  const latCell = Math.round(latitude / latStep)
  const lonCell = Math.round(longitude / lonStep)
  return {
    latitude: Number((latCell * latStep).toFixed(6)),
    longitude: Number((lonCell * lonStep).toFixed(6)),
    cellKey: `${latCell}:${lonCell}`
  }
}
module.exports = { blurLocation }
