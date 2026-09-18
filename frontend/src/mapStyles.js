// Fonds de carte disponibles. Tous fonctionnent sans clé d'API ; ceux de
// Mapbox s'ajoutent automatiquement si VITE_MAPBOX_TOKEN est présent — dans
// frontend/.env pour le site, en secret du dépôt GitHub pour l'app iPhone.
//
// `contrast` indique sur quel fond le tracé se détache : les couleurs du
// parcours et des libellés s'y adaptent, sinon un tracé vert sur imagerie
// satellite devient illisible.
//
// `description` est la phrase que montre le sélecteur : un nom seul (« Plan »,
// « Clair ») ne dit pas à quoi sert un fond, ni pourquoi en changer.
//
// `transform`, facultatif, retouche la feuille de style une fois téléchargée
// et avant qu'elle ne s'affiche.
//
// `offline: false` : ce fond ne se garde pas hors ligne. C'est le cas des
// tuiles d'OpenStreetMap, dont les conditions d'usage interdisent le
// téléchargement en masse, et de celles de Mapbox, dont les conditions le
// réservent à leurs propres kits — sans compter qu'une carte gardée
// consommerait d'un coup des centaines de tuiles du quota gratuit. Les cartes
// hors ligne prennent alors le fond par défaut, et le disent.

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const ESRI_IMAGERY = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics',
    },
    labels: {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© contributeurs OpenStreetMap, © CARTO',
    },
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'imagery' },
    { id: 'labels', type: 'raster', source: 'labels' },
  ],
}

// Le rendu de référence d'OpenStreetMap, celui du site openstreetmap.org. Des
// tuiles image, servies par la fondation : utilisables pour consulter, pas
// pour aspirer — d'où `offline: false` plus bas.
const OSM_STANDARD = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© contributeurs OpenStreetMap',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

// Les fonds d'OpenFreeMap : des cartes OpenStreetMap vectorielles, gratuites et
// sans clé, hébergées bénévolement. Même données que Mapbox, rendu comparable.
const OPENFREEMAP = 'https://tiles.openfreemap.org/styles'

const TOPO = {
  version: 8,
  sources: {
    topo: {
      type: 'raster',
      tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 17,
      attribution: '© OpenTopoMap (CC-BY-SA), © contributeurs OpenStreetMap',
    },
  },
  layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
}

/**
 * Les fonds Mapbox, en tuiles image.
 *
 * Pas leur feuille de style vectorielle : elle désigne ses données par des
 * adresses `mapbox://…` que seul le moteur de Mapbox sait résoudre, et
 * MapLibre s'arrêtait dessus — le fond restait noir. Mapbox fournit pour cet
 * usage le rendu de ses styles en images (« Static Tiles »), prévu pour les
 * bibliothèques tierces. En 512 px et double densité, le texte reste net sur
 * un écran de téléphone.
 */
const mapboxRaster = (id) => ({
  version: 8,
  sources: {
    mapbox: {
      type: 'raster',
      tiles: [
        `https://api.mapbox.com/styles/v1/mapbox/${id}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
      ],
      tileSize: 512,
      maxzoom: 22,
      attribution: '© Mapbox © contributeurs OpenStreetMap',
    },
  },
  layers: [{ id: 'mapbox', type: 'raster', source: 'mapbox' }],
})

// --- « Nuit » : la carte sombre de CARTO, aux couleurs de l'interface --------

const NIGHT_HUE = 262 // le violet de l'accent
const WATER_HUE = 244 // l'eau tire vers l'indigo, pour se lire encore comme de l'eau
const WATER_LAYERS = /^water/

/**
 * Chaque couleur garde sa **clarté** et ne change que de teinte : les routes
 * restent plus claires que le fond, les grands axes plus que les petites rues,
 * et toute la hiérarchie du dessin de CARTO est intacte. Seul le gris neutre
 * devient un gris violacé, qui s'accorde au panneau au lieu de le faire
 * paraître sorti d'une autre application.
 *
 * Le style reçu n'est pas modifié : on en rend une copie.
 */
export function tintNight(style) {
  const layers = style.layers.map((layer) => {
    if (!layer.paint) return layer
    const water = WATER_LAYERS.test(layer.id)
    const paint = {}
    for (const [key, value] of Object.entries(layer.paint)) {
      paint[key] = key.includes('color') ? recolor(value, water) : value
    }
    return { ...layer, paint }
  })
  return { ...style, layers }
}

// Descend dans les paliers (`stops`) et les expressions : une couleur peut s'y
// trouver à n'importe quelle profondeur. Les autres chaînes — noms d'opérateurs,
// `transparent` — ne se lisent pas comme des couleurs et passent telles quelles.
function recolor(value, water) {
  if (typeof value === 'string') return tint(value, water) ?? value
  if (Array.isArray(value)) return value.map((v) => recolor(v, water))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = recolor(v, water)
    return out
  }
  return value
}

function tint(css, water) {
  const rgba = parseColor(css)
  if (!rgba) return null
  const [r, g, b, a] = rgba
  const light = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255
  // Saturation dosée selon la clarté : un soupçon dans les noirs, davantage
  // dans les gris moyens (les routes), presque rien dans les clairs (les
  // libellés), qui doivent rester lisibles avant d'être jolis.
  const sat = water ? 30 : light < 0.12 ? 24 : light < 0.5 ? 18 : 10
  const l = Math.min(1, light + (water ? 0.02 : 0))
  return `hsla(${water ? WATER_HUE : NIGHT_HUE}, ${sat}%, ${(l * 100).toFixed(1)}%, ${a})`
}

function parseColor(css) {
  const s = css.trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(s)
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1)
  m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1)
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s)
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
  return null
}

// --- les libellés en français ------------------------------------------------

// Le nom français quand OpenStreetMap le connaît, le nom local sinon — en
// France, c'est le même.
const FRENCH_NAME = ['coalesce', ['get', 'name:fr'], ['get', 'name']]

// Un libellé fait uniquement du nom (`{name}`, `{name_en}`, ou des paliers de
// ces deux-là). Les autres — numéros de rue, noms suivis d'une altitude — sont
// laissés tels quels : les remplacer en perdrait une partie.
const onlyName = (v) =>
  typeof v === 'string'
    ? /^\{name(_en)?\}$/.test(v)
    : Array.isArray(v)
      ? v.every((x) => typeof x === 'number' || onlyName(x))
      : v && typeof v === 'object'
        ? Object.values(v).every(onlyName)
        : false

/**
 * Les styles de CARTO nomment les lieux en anglais : « 5th Arrondissement »,
 * « Latin Quarter » en pleine carte de Paris. Leurs tuiles portent pourtant le
 * nom français (`name:fr`) ; on le leur fait lire.
 */
export function frenchLabels(style) {
  const layers = style.layers.map((layer) => {
    const field = layer.layout?.['text-field']
    if (field === undefined || !onlyName(field)) return layer
    return { ...layer, layout: { ...layer.layout, 'text-field': FRENCH_NAME } }
  })
  return { ...style, layers }
}

// -----------------------------------------------------------------------------

export const MAP_STYLES = [
  {
    // La clé reste `dark` : c'est celle qu'ont mémorisée les réglages et les
    // cartes gardées hors ligne. Les tuiles sont les mêmes, seul le rendu change.
    key: 'dark',
    label: 'Nuit',
    swatch: '#15121d',
    contrast: 'dark',
    description: "Sombre, aux couleurs de l'app : le tracé ressort, et l'écran éblouit moins le soir.",
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    transform: (style) => tintNight(frenchLabels(style)),
  },
  {
    key: 'fiord',
    label: 'Fjord',
    swatch: '#2b4250',
    contrast: 'dark',
    description: 'Sombre et bleuté, parcs et eau bien distincts : lisible de jour comme de nuit.',
    style: `${OPENFREEMAP}/fiord`,
  },
  {
    key: 'streets',
    label: 'Rues',
    swatch: '#f2efe9',
    contrast: 'light',
    description: 'Rues détaillées avec leurs noms, commerces, numéros de route : idéal pour se repérer en ville.',
    style: `${OPENFREEMAP}/liberty`,
  },
  {
    key: 'light',
    label: 'Clair',
    swatch: '#e8eaed',
    contrast: 'light',
    description: 'Clair et épuré, presque sans couleur : le plus lisible en plein soleil.',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    transform: frenchLabels,
  },
  {
    key: 'plan',
    label: 'Plan',
    swatch: '#cfd8c8',
    contrast: 'light',
    description: "Plan en couleurs, parcs, eau et bâtiments : le plus proche d'une carte routière.",
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    transform: frenchLabels,
  },
  {
    // La clé reste `topo` pour la même raison que `dark` ci-dessus.
    key: 'topo',
    label: 'Nature',
    swatch: '#c9b99a',
    contrast: 'light',
    description: 'Relief, courbes de niveau, sentiers et chemins : pour les terrains mixtes et la montagne.',
    style: TOPO,
  },
  {
    key: 'satellite',
    label: 'Satellite',
    swatch: '#3d4a35',
    contrast: 'dark',
    description: "Photo aérienne avec le nom des rues : pour voir l'ombre d'une allée, un parc, un chemin de terre.",
    style: ESRI_IMAGERY,
  },
  {
    key: 'osm',
    label: 'OpenStreetMap',
    swatch: '#aad3df',
    contrast: 'light',
    description: "Le rendu du site OpenStreetMap, celui des contributeurs. Ne se garde pas hors ligne : OpenStreetMap l'interdit.",
    style: OSM_STANDARD,
    offline: false,
  },
  ...(MAPBOX_TOKEN
    ? [
        {
          key: 'mapbox',
          label: 'Mapbox nuit',
          swatch: '#1b2431',
          contrast: 'dark',
          description: 'Le fond sombre de navigation de Mapbox, avec ses numéros de route.',
          style: mapboxRaster('navigation-night-v1'),
          offline: false,
        },
        {
          // Sentiers, courbes de niveau, ombrage du relief : le fond le plus
          // utile dès qu'on court hors des villes.
          key: 'mapbox-outdoors',
          label: 'Mapbox nature',
          swatch: '#d7e2c6',
          contrast: 'light',
          description: 'Relief ombré, sentiers de randonnée et courbes de niveau, par Mapbox.',
          style: mapboxRaster('outdoors-v12'),
          offline: false,
        },
        {
          key: 'mapbox-satellite',
          label: 'Mapbox satellite',
          swatch: '#33402c',
          contrast: 'dark',
          description: 'Imagerie satellite haute résolution de Mapbox, avec les rues par-dessus.',
          style: mapboxRaster('satellite-streets-v12'),
          offline: false,
        },
        {
          key: 'mapbox-streets',
          label: 'Mapbox standard',
          swatch: '#eceae4',
          contrast: 'light',
          description: 'Le style classique de Mapbox, simple et clair.',
          style: mapboxRaster('streets-v12'),
          offline: false,
        },
      ]
    : []),
]

export const DEFAULT_STYLE = 'dark'

export function styleByKey(key) {
  return MAP_STYLES.find((s) => s.key === key) || MAP_STYLES[0]
}

/** Options de chargement d'un fond : sa retouche éventuelle, faite avant
 *  affichage. MapLibre n'accepte de retoucher un style que par `setStyle`. */
export function loadOptions(entry) {
  return entry.transform ? { transformStyle: (_previous, next) => entry.transform(next) } : {}
}

/** Le fond à garder hors ligne quand on regarde celui-ci : lui-même s'il le
 *  permet, le fond par défaut sinon. */
export function offlineStyleFor(key) {
  const style = styleByKey(key)
  return style.offline === false ? styleByKey(DEFAULT_STYLE) : style
}

// Couleurs du tracé selon le niveau de risque. Le jeu « light » est plus
// saturé : sur un fond clair, un vert pâle disparaît.
export const TRACE_COLORS = {
  dark: { safe: '#32D74B', caution: '#FFD426', risk: '#FF6A45', halo: '#0A0910' },
  light: { safe: '#0F8A2E', caution: '#B37400', risk: '#C42D0B', halo: '#FFFFFF' },
}
