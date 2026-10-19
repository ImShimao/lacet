// L'indice vert — portage au bit près de `backend/app/osm/green.py`.
//
// La part de chaque arête qui longe un parc, un bois ou l'eau : l'équivalent
// libre de la carte de chaleur de Strava. Les zones vertes sont peintes une fois
// sur une grille de 50 m, épaissie de deux cases, et chaque arête y lit tous les
// 25 m si elle est à portée. Le pourquoi de chaque choix est dans le module
// Python ; ici, seule la forme change : la grille est un `Uint8Array` au lieu de
// lignes d'entiers, avec exactement les mêmes cases allumées.

import { pyfloordiv, radians } from './py'

const CELL_M = 50
const REACH_CELLS = 2
const SAMPLE_M = 25

/** `int(x // CELL_M)` */
const cellOf = (x) => Math.trunc(pyfloordiv(x, CELL_M))

/**
 * Pour chaque arête du graphe, la part de sa longueur près du vert (0 à 1).
 * `areas` : `[{id, fill, rings: [Float64Array…]}]`, géométries à plat.
 */
export function greenIndex(graph, areas, origin) {
  const edges = graph.edgeCount
  const out = new Float64Array(edges)
  if (!areas.length || !edges) return out

  // Calée sur le degré entier le plus proche, pas sur l'origine du graphe —
  // voir Python.
  const ox = Math.floor(origin[0] + 0.5)
  const oy = Math.floor(origin[1] + 0.5)
  const kx = 111_320 * Math.cos(radians(oy))
  const ky = 110_540
  const project = (flat, start, count) => {
    const xy = new Float64Array(count * 2)
    for (let k = 0; k < count; k += 1) {
      xy[2 * k] = (flat[2 * (start + k)] - ox) * kx
      xy[2 * k + 1] = (flat[2 * (start + k) + 1] - oy) * ky
    }
    return xy
  }

  // Les géométries des arêtes, de A vers B — l'ordre de `edge.coords` en Python.
  const paths = new Array(edges)
  let gx0 = Infinity
  let gy0 = Infinity
  let gx1 = -Infinity
  let gy1 = -Infinity
  for (let e = 0; e < edges; e += 1) {
    const path = project(graph.coords, graph.edgeCoordStart[e], graph.edgeCoordCount[e])
    paths[e] = path
    for (let i = 0; i < path.length; i += 2) {
      const cx = cellOf(path[i])
      const cy = cellOf(path[i + 1])
      if (cx < gx0) gx0 = cx
      if (cx > gx1) gx1 = cx
      if (cy < gy0) gy0 = cy
      if (cy > gy1) gy1 = cy
    }
  }
  gx0 -= REACH_CELLS
  gy0 -= REACH_CELLS
  gx1 += REACH_CELLS
  gy1 += REACH_CELLS
  const width = gx1 - gx0 + 1
  const height = gy1 - gy0 + 1
  const grid = new Uint8Array(width * height)

  const mark = (x, y) => {
    const cx = cellOf(x) - gx0
    const cy = cellOf(y) - gy0
    if (cx >= 0 && cx < width && cy >= 0 && cy < height) grid[cy * width + cx] = 1
  }

  for (const area of areas) {
    const rings = area.rings.map((flat) => project(flat, 0, flat.length / 2))

    // Le contour, comme un trait.
    for (const ring of rings) {
      if (!ring.length) continue
      mark(ring[0], ring[1])
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const px = ring[i]
        const py = ring[i + 1]
        const dx = ring[i + 2] - px
        const dy = ring[i + 3] - py
        const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / (CELL_M / 2)))
        for (let k = 1; k <= n; k += 1) {
          const t = k / n
          mark(px + dx * t, py + dy * t)
        }
      }
    }

    if (!area.fill) continue

    // L'intérieur, ligne par ligne, au centre des cases.
    const cuts = new Map()
    for (const ring of rings) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const px = ring[i]
        const py = ring[i + 1]
        const qx = ring[i + 2]
        const qy = ring[i + 3]
        const first = Math.max(gy0, Math.floor(Math.min(py, qy) / CELL_M) - 1)
        const last = Math.min(gy1, Math.floor(Math.max(py, qy) / CELL_M) + 1)
        for (let cy = first; cy <= last; cy += 1) {
          const yc = (cy + 0.5) * CELL_M
          if (py > yc !== qy > yc) {
            let xs = cuts.get(cy)
            if (!xs) cuts.set(cy, (xs = []))
            xs.push(px + ((qx - px) * (yc - py)) / (qy - py))
          }
        }
      }
    }
    for (const [cy, xs] of cuts) {
      xs.sort((a, b) => a - b)
      const row = (cy - gy0) * width
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(gx0, Math.ceil(xs[i] / CELL_M - 0.5))
        const c1 = Math.min(gx1, Math.ceil(xs[i + 1] / CELL_M - 0.5) - 1)
        for (let cx = c0; cx <= c1; cx += 1) grid[row + cx - gx0] = 1
      }
    }
  }

  // L'épaississement : de chaque côté, puis au-dessus et au-dessous.
  const wide = new Uint8Array(grid.length)
  for (let cy = 0; cy < height; cy += 1) {
    const row = cy * width
    for (let cx = 0; cx < width; cx += 1) {
      if (!grid[row + cx]) continue
      const from = Math.max(0, cx - REACH_CELLS)
      const to = Math.min(width - 1, cx + REACH_CELLS)
      for (let k = from; k <= to; k += 1) wide[row + k] = 1
    }
  }
  const near = new Uint8Array(grid.length)
  for (let cy = 0; cy < height; cy += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      if (!wide[cy * width + cx]) continue
      const from = Math.max(0, cy - REACH_CELLS)
      const to = Math.min(height - 1, cy + REACH_CELLS)
      for (let k = from; k <= to; k += 1) near[k * width + cx] = 1
    }
  }

  for (let e = 0; e < edges; e += 1) {
    const path = paths[e]
    let total = 0
    let green = 0
    for (let i = 0; i + 3 < path.length; i += 2) {
      const px = path[i]
      const py = path[i + 1]
      const dx = path[i + 2] - px
      const dy = path[i + 3] - py
      const length = Math.sqrt(dx * dx + dy * dy)
      const n = Math.max(1, Math.ceil(length / SAMPLE_M))
      const piece = length / n
      total += length
      for (let k = 0; k < n; k += 1) {
        const t = (k + 0.5) / n
        const cx = cellOf(px + dx * t) - gx0
        const cy = cellOf(py + dy * t) - gy0
        if (cy >= 0 && cy < height && cx >= 0 && cx < width && near[cy * width + cx]) green += piece
      }
    }
    out[e] = total > 0 ? green / total : 0
  }
  return out
}
