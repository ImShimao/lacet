// Les rues qu'un signalement écarte.
//
// « Travaux ici », « route barrée » : ce qu'on a vu sur le terrain et qu'aucune
// carte ne dit. OpenStreetMap ignore la benne posée ce matin, la barrière du
// chantier et le portail du parc fermé à vingt heures ; c'est précisément ce
// qui fait faire un kilomètre pour rien, et revenir sur ses pas.
//
// Un signalement est **un point**, pas une rue : on ne demande à personne de
// choisir un tronçon sur une carte en courant. Le rapprochement se fait ici —
// toute arête qui passe à moins de vingt-cinq mètres du point est écartée du
// routage (voir `weights.js`).
//
// Vingt-cinq mètres, c'est la largeur d'une rue avec ses deux trottoirs, plus
// l'imprécision d'un GPS de téléphone. En dessous, le point signalé depuis le
// trottoir d'en face ne toucherait pas la chaussée barrée ; bien au-dessus, on
// écarterait la rue perpendiculaire, qui elle est ouverte.

const RAD = Math.PI / 180

/** Rayon d'effet d'un signalement, en mètres. */
export const BLOCK_RADIUS_M = 25

/**
 * Les arêtes touchées par au moins un signalement, par leur identifiant.
 *
 * `reports` est une liste de points `[lon, lat]`. Rend `null` quand il n'y en a
 * aucun : le profil de poids n'a alors rien à vérifier, et le cas courant — la
 * plupart des sorties — ne coûte pas un test par arête.
 */
export function blockedEdges(graph, reports, radiusM = BLOCK_RADIUS_M) {
  const points = (reports || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]))
  if (!points.length || !graph.edgeCount) return null

  // Le tri grossier se fait en degrés, sans racine carrée ni cosinus : une
  // arête dont les deux extrémités sont loin en latitude ou en longitude n'a
  // pas besoin d'être mesurée. C'est ce qui rend acceptable la boucle sur
  // toutes les arêtes du graphe.
  const dLat = radiusM / 110_540
  const out = new Set()

  for (const [rLon, rLat] of points) {
    const kx = Math.cos(rLat * RAD) * 111_320
    const dLon = radiusM / Math.max(1, kx)
    for (let e = 0; e < graph.edgeCount; e += 1) {
      if (out.has(e)) continue
      const start = graph.edgeCoordStart[e]
      const count = graph.edgeCoordCount[e]
      for (let i = 0; i + 1 < count; i += 1) {
        const aLon = graph.coords[2 * (start + i)]
        const aLat = graph.coords[2 * (start + i) + 1]
        const bLon = graph.coords[2 * (start + i + 1)]
        const bLat = graph.coords[2 * (start + i + 1) + 1]
        if (Math.min(aLat, bLat) - rLat > dLat || rLat - Math.max(aLat, bLat) > dLat) continue
        if (Math.min(aLon, bLon) - rLon > dLon || rLon - Math.max(aLon, bLon) > dLon) continue
        if (toSegment(rLon, rLat, aLon, aLat, bLon, bLat, kx) <= radiusM) {
          out.add(e)
          break
        }
      }
    }
  }
  return out.size ? out : null
}

/**
 * Les arêtes qui entrent dans une zone à éviter, ajoutées à celles des signalements.
 *
 * Une zone est un disque `{ lon, lat, radius_m }` — le même calcul qu'un
 * signalement, avec un rayon choisi au lieu de vingt-cinq mètres — ou un
 * contour `{ polygon: [[lon, lat], …] }`, posé point par point : un bois en
 * longueur ou un quartier coincé entre deux avenues ne tiennent pas dans un
 * cercle sans déborder sur les rues d'à côté. Elle pèse comme un signalement —
 * un mur, sauf quand il n'y a pas d'autre chemin : c'est ce qui laisse sortir
 * d'une zone qu'on a dessinée autour de son propre départ, au lieu de ne
 * trouver aucune boucle.
 */
export function withZones(graph, blocked, zones) {
  let out = blocked
  for (const zone of zones || []) {
    const hit = zone.polygon ? polygonEdges(graph, zone.polygon) : blockedEdges(graph, [[zone.lon, zone.lat]], zone.radius_m)
    if (hit) out = out ? new Set([...out, ...hit]) : hit
  }
  return out
}

/**
 * Les arêtes qui entrent dans un contour : un point dedans, ou un segment qui
 * coupe son bord — une avenue qui traverse un parc de part en part sans s'y
 * arrêter y entre aussi. Calcul à plat en degrés : à l'échelle d'un quartier,
 * l'écart avec la sphère ne se mesure pas.
 */
export function polygonEdges(graph, ring) {
  if (!graph.edgeCount || !ring || ring.length < 3) return null
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }
  const out = new Set()
  for (let e = 0; e < graph.edgeCount; e += 1) {
    const start = graph.edgeCoordStart[e]
    const count = graph.edgeCoordCount[e]
    for (let i = 0; i + 1 < count; i += 1) {
      const a = [graph.coords[2 * (start + i)], graph.coords[2 * (start + i) + 1]]
      const b = [graph.coords[2 * (start + i + 1)], graph.coords[2 * (start + i + 1) + 1]]
      if (Math.max(a[0], b[0]) < minLon || Math.min(a[0], b[0]) > maxLon) continue
      if (Math.max(a[1], b[1]) < minLat || Math.min(a[1], b[1]) > maxLat) continue
      if (insideRing(a, ring) || insideRing(b, ring) || crossesRing(a, b, ring)) {
        out.add(e)
        break
      }
    }
  }
  return out.size ? out : null
}

/** Le point est-il dans l'anneau ? Le rayon lancé vers l'est compte les bords franchis. */
export function insideRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))

/** Le segment [a, b] coupe-t-il un bord de l'anneau ? */
function crossesRing(a, b, ring) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const c = ring[j]
    const d = ring[i]
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true
  }
  return false
}

/** Distance d'un point à un segment, en mètres locaux. */
function toSegment(pLon, pLat, aLon, aLat, bLon, bLat, kx) {
  const px = (pLon - aLon) * kx
  const py = (pLat - aLat) * 110_540
  const bx = (bLon - aLon) * kx
  const by = (bLat - aLat) * 110_540
  const length = bx * bx + by * by
  const t = length > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / length)) : 0
  return Math.hypot(px - bx * t, py - by * t)
}
