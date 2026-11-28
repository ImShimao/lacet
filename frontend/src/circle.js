/** Cercle géographique approché — MapLibre ne sait pas dessiner un rayon en mètres. */
export function circlePolygon([lon, lat], radiusM, steps = 48) {
  const dLat = radiusM / 111_320
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  const ring = []
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI
    ring.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

/** La forme d'une zone à éviter : son tracé à main levée, sinon son cercle. */
export function zoneShape(z) {
  return z.polygon ? { type: 'Polygon', coordinates: [[...z.polygon, z.polygon[0]]] } : circlePolygon([z.lon, z.lat], z.radius_m)
}
