// Ce que veut dire chaque réglage, en clair.
//
// « Vallonné », « Mixte », « Sûr » : des mots qu'on comprend chacun à sa façon.
// Le moteur, lui, leur donne un sens précis — un facteur de préférence, une
// cible de dénivelé par kilomètre, un plafond de portion exposée. Ces textes
// disent ce sens-là, avec ses chiffres, pour qu'on sache ce qu'on choisit.
//
// Les chiffres viennent du moteur : `engine/weights.js` (terrain),
// `engine/service.js` (dénivelé), `engine/safety.js` (sécurité, notes). S'ils
// changent là-bas, ils doivent changer ici.

import { isNight } from './engine/environment'
import { km } from './format'
import { unitLabel } from './units'

const TERRAIN_RUN = {
  title: 'Types de terrain',
  items: [
    {
      icon: 'road',
      label: 'Route',
      text: "Sols durs d'abord : trottoirs, bitume, pistes. Un chemin de terre n'est pris que s'il évite un vrai détour, et les boucles à plus de 10 % de chemins passent derrière les autres.",
    },
    {
      icon: 'forest',
      label: 'Mixte',
      text: "Un mélange : entre 15 et 85 % de chemins et sentiers passent devant le tout-bitume. Le bon choix par défaut — en ville, sans chemins, rien ne change.",
    },
    {
      icon: 'mountain',
      label: 'Sentier',
      text: "Chemins et sentiers d'abord, y compris ceux des bois et des champs, que la recherche va chercher en plus. Au moins la moitié de la boucle hors bitume passe devant ; le bitume ne sert qu'à relier.",
    },
  ],
}

const TERRAIN_BIKE = {
  title: 'Types de terrain',
  items: [
    {
      icon: 'road',
      label: 'Route',
      text: 'Bitume et pistes cyclables. Les chemins de gravier sont évités, les sentiers presque toujours.',
    },
    {
      icon: 'forest',
      label: 'Mixte',
      text: "Bitume et chemins stabilisés se valent : pour un vélo polyvalent ou un gravel. Les sentiers étroits restent évités.",
    },
    {
      icon: 'mountain',
      label: 'VTT',
      text: 'Chemins et sentiers en priorité, bitume seulement pour les relier.',
    },
  ],
}

const RELIEF = {
  title: 'Comprendre le relief',
  intro:
    "Le dénivelé positif (D+) est le total des montées sur la boucle. Les seuils, en mètres de montée par kilomètre : plat vers 3, vallonné vers 10, côtes à partir de 22. Le badge de chaque réglage dit si le terrain autour du départ le permet : Probable, Possible ou Peu probable, d'après les altitudes déjà sur ton téléphone. Celles qui tiennent le réglage passent devant les autres ; en plaine, « Côtes » ne peut pas inventer de colline.",
  items: [
    {
      icon: 'flat',
      label: 'Plat',
      text: 'Le moins de montée possible : vers 3 m par kilomètre, soit une trentaine de mètres pour 10 km. Pour une sortie facile ou une récupération.',
    },
    {
      icon: 'rolling',
      label: 'Vallonné',
      text: 'Un peu de relief sans chercher la côte : vers 10 m par kilomètre, une centaine de mètres pour 10 km.',
    },
    {
      icon: 'hilly',
      label: 'Côtes',
      text: 'Les montées sont recherchées : 20 m par kilomètre et plus, 200 m et au-delà pour 10 km. Pour travailler la force et le souffle.',
    },
    {
      icon: 'mountain',
      label: 'D+ précis',
      text: "« Environ 150 m » plutôt qu'un des trois réglages. Les boucles à 20 % près passent devant — jamais moins de 20 m de marge pour 10 km —, et entre elles, la sécurité décide.",
    },
  ],
}

// Les bandes de `ELEVATION_BAND_PER_KM`, dans `engine/service.js` : hors de sa
// bande, une boucle est pénalisée au classement — mais proposée quand même, s'il
// n'y a rien d'autre.
const RELIEF_BAND_PER_KM = { flat: [0, 10], hilly: [12, Infinity] }

/**
 * Le badge d'un relief avant de chercher, d'après le D+ possible près du départ
 * (`reliefHint`, en m/km). « Plat » veut peu de montée, « Côtes » beaucoup,
 * « Vallonné » entre les deux ; un D+ précis tient si sa cible est sous ce qui
 * se trouve autour, ou à peine au-dessus. Rend `Probable`, `Possible`,
 * `Peu probable`, ou `null` quand le terrain n'est pas gardé.
 */
//
// Seuils calés le 21 novembre 2026 (`measure_loops.mjs --hint`, 7 départs de
// Lautenbach à Ensisheim, 5, 10 et 15 km) : `reachable` mesure le relief du
// terrain, et une boucle n'en ramasse que 20 à 60 %. Avec les anciens seuils,
// « Plat » était « Peu probable » à Soultz (relief 27 à 40, boucles plates à
// 3-5 m/km), et 90 m/km de D+ « Probable » à Lautenbach, qui plafonne à 50.
export function reliefBadge(key, reachable, climbPerKm = null) {
  if (reachable == null) return null
  const e = reachable
  // Plat tient jusqu'à Guebwiller (relief 54 à 65, boucles à 6-10 m/km), pas à Buhl (75 et plus).
  const flat = e <= 45 ? 2 : e <= 70 ? 1 : 0
  let level = 0
  if (key === 'flat') level = flat
  // Vallonné manque en pleine plaine (Ensisheim, 5,5 : 1 à 3 m/km) et au fond des vallées.
  else if (key === 'rolling') level = e >= 10 && e <= 65 ? 2 : e >= 6 && e <= 80 ? 1 : 0
  // Côtes vient dès Rouffach (15, boucles à 14-27 m/km), jamais à Ensisheim.
  else if (key === 'hilly') level = e >= 20 ? 2 : e >= 12 ? 1 : 0
  // Un D+ précis : les meilleures boucles montent à la moitié du relief, rarement aux quatre cinquièmes.
  else if (key === 'climb') {
    level = climbPerKm <= 0.5 * e ? 2 : climbPerKm <= 0.8 * e ? 1 : 0
    // Peu de D+ en montagne, c'est du plat : il en prend la limite.
    if (climbPerKm < 10) level = Math.min(level, flat)
  }
  return ['Peu probable', 'Possible', 'Probable'][level]
}

/**
 * La météo du départ, et ce qu'elle change à la tenue. Rend `{ icon, text }`,
 * ou `null` sans température. Les seuils sont ceux des guides de tenue de
 * course : sous 4 °C les extrémités gèlent, au-dessus de 26 °C la chaleur
 * coûte de l'allure, et 0,2 mm dans l'heure suffit à tremper un t-shirt.
 */
export function weatherAdvice(weather) {
  if (!Number.isFinite(weather?.temp_c)) return null
  const temp = `${Math.round(weather.temp_c)} °C`
  if (weather.rain_mm >= 0.2) {
    return { icon: 'rain', text: `${temp}, pluie annoncée dans l'heure : une veste imperméable, et prudence sur les pavés et les feuilles.` }
  }
  if (weather.temp_c < 4) return { icon: 'moon', text: `${temp} au départ : gants, bonnet et une couche de plus — tu l'enlèveras après l'échauffement.` }
  if (weather.temp_c > 26) return { icon: 'sun', text: `${temp} au départ : emporte de l'eau, et ralentis l'allure plutôt que de la tenir.` }
  return { icon: 'sun', text: `${temp} et sec au départ.` }
}

/**
 * Le caractère d'une boucle, dans les mots des réglages : `Plat`, `Vallonné` ou
 * `Côtes`, ou `null` sans altitude. « Côtes » commence là où la bande de
 * `RELIEF_BAND_PER_KM.hilly` commence : une boucle rendue pour « Côtes » sans
 * avertissement se lit toujours « Côtes ». « Plat » s'arrête à 6 m/km, entre
 * le plat (3) et le vallonné (10) des textes.
 */
export function reliefOf(route) {
  if (route?.ascent_m == null || !(route.distance_m > 0)) return null
  const perKm = route.ascent_m / (route.distance_m / 1000)
  return perKm < 6 ? 'Plat' : perKm < RELIEF_BAND_PER_KM.hilly[0] ? 'Vallonné' : 'Côtes'
}

/**
 * Le relief demandé que le terrain n'a pas pu donner : « Côtes » en plaine,
 * « Plat » en montagne. Rend `{ kind, ascent }` — la boucle qui s'en approche
 * le plus, et son D+ — ou `null` quand au moins une boucle tient la bande.
 *
 * Le moteur choisit au plus près de la cible sans pouvoir inventer de colline :
 * à Colmar, « Côtes » rendait cinq boucles de 8 à 23 m de D+ sur 10 km, sans un
 * mot. On demandait des côtes ; on croyait les avoir.
 */
export function reliefMismatch(elevation, routes) {
  const band = RELIEF_BAND_PER_KM[elevation]
  const measured = (routes ?? []).filter((r) => r.ascent_m != null && r.distance_m > 0)
  if (!band || !measured.length) return null
  const perKm = (r) => r.ascent_m / (r.distance_m / 1000)
  if (elevation === 'hilly') {
    const best = measured.reduce((a, b) => (perKm(b) > perKm(a) ? b : a))
    return perKm(best) < band[0] ? { kind: 'hilly', ascent: Math.round(best.ascent_m) } : null
  }
  const best = measured.reduce((a, b) => (perKm(b) < perKm(a) ? b : a))
  return perKm(best) > band[1] ? { kind: 'flat', ascent: Math.round(best.ascent_m) } : null
}

/**
 * La fourchette d'un D+ visé, en mètres — celle de `elevationGoal`, dans
 * `engine/service.js` : 20 % de part et d'autre, jamais moins de 2 m/km.
 */
export function climbBand(climb, km) {
  const half = Math.max(0.2 * climb, 2 * km)
  return [Math.max(0, climb - half), climb + half]
}

/**
 * Le D+ visé qu'aucune boucle ne tient : 400 m demandés en plaine. Rend
 * `{ kind: 'climb', ascent }` — la boucle la plus proche, et son D+ — ou `null`
 * dès qu'une boucle tombe dans la fourchette.
 */
export function climbMismatch(climb, routes) {
  const measured = (routes ?? []).filter((r) => r.ascent_m != null && r.distance_m > 0)
  if (climb == null || !measured.length) return null
  const best = measured.reduce((a, b) => (Math.abs(b.ascent_m - climb) < Math.abs(a.ascent_m - climb) ? b : a))
  const [low, high] = climbBand(climb, best.distance_m / 1000)
  return best.ascent_m < low || best.ascent_m > high ? { kind: 'climb', ascent: Math.round(best.ascent_m) } : null
}

// Les fourchettes de `SURFACE_BAND`, dans `engine/service.js` : la part du
// tracé hors bitume. « Mixte » n'y est pas : réglé par défaut, il se dirait en
// permanence en ville, où il n'y a simplement pas de chemins.
const SURFACE_BAND = { road: [0, 0.1], trail: [0.5, 1] }

/**
 * Le terrain demandé que le coin n'a pas : « Sentier » en ville, « Route »
 * entre les vignes. Rend `{ kind, share }` — la part hors bitume, en pour cent,
 * de la boucle qui s'en approche le plus — ou `null` dès qu'une boucle tient la
 * fourchette.
 */
export function surfaceMismatch(surface, routes) {
  const band = SURFACE_BAND[surface]
  const measured = (routes ?? []).filter((r) => r.surfaces && r.distance_m > 0)
  if (!band || !measured.length) return null
  const share = (r) => (r.surfaces.gravel_m + r.surfaces.trail_m) / r.distance_m
  const gap = (r) => Math.max(band[0] - share(r), share(r) - band[1], 0)
  const best = measured.reduce((a, b) => (gap(b) < gap(a) ? b : a))
  return gap(best) > 0 ? { kind: surface, share: Math.round(share(best) * 100) } : null
}

// Les plafonds de `THRESHOLDS`, dans `engine/safety.js` : un vélo roule sur la
// chaussée par nature, et ses plafonds sont plus larges.
const SAFETY_LIMITS = {
  run: { safe: [3, 150], standard: 8 },
  bike: { safe: [8, 1000], standard: 20 },
}

const safety = (sport) => {
  const { safe, standard } = SAFETY_LIMITS[sport] ?? SAFETY_LIMITS.run
  return {
    title: 'Sécurité',
    intro:
      "Chaque boucle est notée A, B ou C. A : quasiment tout sur trottoir ou voie propre, et aucune traversée sans passage protégé. B : quelques mètres au contact du trafic. C : davantage. Tout vient d'OpenStreetMap — un chantier d'hier n'y est pas encore.",
    items: [
      {
        icon: 'shield',
        label: 'Sûr',
        text: `Contourne, tronçon par tronçon, les routes rapides sans trottoir ni accotement, puis écarte toute boucle qui en garde trop ou qui les traverse sans passage protégé : au plus ${safe[0]} % du parcours au contact du trafic, jamais plus de ${safe[1]} m d'affilée. C'est ce que faisait la case « Grands axes », qui n'existe plus.`,
      },
      {
        icon: 'warning',
        label: 'Standard',
        text: `Montre aussi les boucles plus exposées — jusqu'à ${standard} % au contact du trafic — avec le détail des portions concernées. Pour un coin que tu connais, ou quand « Sûr » ne trouve rien.`,
      },
    ],
  }
}

// Les facteurs d'`AVOID_FACTOR`, dans `engine/weights.js` : vingt-cinq fois la
// longueur. Un évitement n'interdit pas — il rend le détour presque toujours
// préférable.
const AVOID = {
  title: 'Ce qu’on évite',
  intro:
    "Un évitement multiplie par vingt-cinq la longueur ressentie du tronçon : un escalier de trente mètres en coûte sept cent cinquante, et tout détour raisonnable le bat. Ce n'est pas une interdiction — quand c'est le seul accès, la boucle passe quand même, plutôt que de ne rien proposer du tout.",
  items: [
    {
      icon: 'stairs',
      label: 'Escaliers',
      text: "Les volées de marches d'OpenStreetMap (`highway=steps`). Cent mètres de dénivelé pris dans un escalier, ce n'est pas la même sortie qu'une côte régulière — et à vélo, ils sont interdits de toute façon.",
    },
    {
      icon: 'moon',
      label: 'Rues non éclairées',
      text: "Les voies explicitement données comme non éclairées (`lit=no`). Celles qui ne disent rien ne sont pas pénalisées : la moitié des rues d'un village n'ont simplement pas l'information, et les écarter viderait la carte.",
    },
    {
      icon: 'refresh',
      label: 'Boucles déjà courues',
      text: "Les sorties passées depuis ce départ, à peu près de cette longueur : une proposition qui suit l'une d'elles sur les deux tiers passe après celles jamais courues d'ici. Après seulement — si c'est la seule sûre, ou la seule qui tient les réglages, elle reste proposée.",
    },
    {
      icon: 'shield',
      label: 'Et la circulation ?',
      text: "C'est le réglage « Sécurité » qui s'en charge : en « Sûr », chaque bout de route rapide sans trottoir est contourné. Il n'y a rien à cocher en plus.",
    },
  ],
}

const SPORT = {
  title: 'Activité',
  items: [
    {
      icon: 'run',
      label: 'Course',
      text: "Trottoirs, allées et chemins piétons. Les escaliers sont évités sans être interdits. Jusqu'à 60 km.",
    },
    {
      icon: 'bike',
      label: 'Vélo',
      text: "Pistes et bandes cyclables, routes calmes. Les voies réservées aux piétons sont fortement évitées. Jusqu'à 250 km.",
    },
  ],
}

/** L'explication d'un réglage, dans le vocabulaire du sport choisi. */
export function explain(topic, sport = 'run') {
  if (topic === 'terrain') return sport === 'bike' ? TERRAIN_BIKE : TERRAIN_RUN
  if (topic === 'safety') return safety(sport)
  return { relief: RELIEF, sport: SPORT, avoid: AVOID }[topic] ?? null
}

/**
 * La nuit qui tombe pendant la boucle : l'heure où elle tombe, si l'on part
 * maintenant et que la boucle dure `durationS` — `null` s'il fait encore jour
 * à l'arrivée, ou déjà nuit au départ (le moteur a alors choisi des rues
 * éclairées, et l'écran le sait).
 *
 * Cherchée à la minute près entre le départ et l'arrivée, avec le calcul du
 * moteur (`isNight`) : c'est lui qui décide quand les rues non éclairées
 * comptent.
 */
export function nightfall(lat, lon, durationS, now = Date.now()) {
  const end = now + durationS * 1000
  if (isNight(lat, lon, new Date(now)) || !isNight(lat, lon, new Date(end))) return null
  let lo = now
  let hi = end
  while (hi - lo > 60_000) {
    const mid = (lo + hi) / 2
    if (isNight(lat, lon, new Date(mid))) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * Deux propositions face à face : les lignes qui les départagent, et une phrase
 * qui dit ce que chacune gagne. Une ligne n'a de gagnant que si l'écart compte —
 * deux minutes sur une heure, oui ; dix secondes, non.
 *
 * Rend `{ rows: [{ label, a, b, best: 'a'|'b'|null }], verdict }`.
 */
export function compareRoutes(a, b, { nameA = 'la 1', nameB = 'la 2' } = {}) {
  const sa = a?.safety
  const sb = b?.safety
  const gains = { a: [], b: [] }
  const rows = []
  // `better` : la valeur la plus petite gagne (`low`) ou la plus grande (`high`).
  const row = (label, va, vb, show, { better = null, min = 0, say = null } = {}) => {
    if (va == null && vb == null) return
    let best = null
    if (better && va != null && vb != null && Math.abs(va - vb) > min) {
      best = (better === 'low') === va < vb ? 'a' : 'b'
      if (say) gains[best].push(say(Math.abs(va - vb), best === 'a' ? va : vb, best === 'a' ? vb : va))
    }
    rows.push({ label, a: va == null ? '—' : show(va), b: vb == null ? '—' : show(vb), best })
  }
  const rank = (g) => (g ? 'ABC'.indexOf(g) : null)
  row('Note', rank(sa?.grade), rank(sb?.grade), (r) => 'ABC'[r], {
    better: 'low',
    say: (_, w, l) => `est plus sûre (${'ABC'[w]} contre ${'ABC'[l]})`,
  })
  row('Distance', a?.distance_m, b?.distance_m, (m) => `${km(m, 1)} ${unitLabel()}`)
  row('Durée', a?.duration_s, b?.duration_s, (s) => `${Math.round(s / 60)} min`, {
    better: 'low',
    min: 90,
    say: (d) => `gagne ${Math.round(d / 60)} min`,
  })
  row('Dénivelé +', a?.ascent_m, b?.ascent_m, (m) => `${Math.round(m)} m`, {
    better: 'low',
    min: 15,
    say: (d) => `monte ${Math.round(d)} m de moins`,
  })
  row('Hors trafic', sa?.protected_share, sb?.protected_share, (s) => `${Math.round(s * 100)} %`, {
    better: 'high',
    min: 0.05,
    say: (d) => `a ${Math.round(d * 100)} points de plus à l'abri du trafic`,
  })
  row('Traversées non protégées', sa?.unprotected_crossings, sb?.unprotected_crossings, String, {
    better: 'low',
    min: 0,
    say: (d) => `traverse ${d} fois de moins sans protection`,
  })
  const phrase = (name, list) => `${name} ${list.length > 1 ? `${list.slice(0, -1).join(', ')} et ${list.at(-1)}` : list[0]}`
  const parts = []
  if (gains.a.length) parts.push(phrase(nameA, gains.a))
  if (gains.b.length) parts.push(phrase(nameB, gains.b))
  const said = parts.join(' ; ')
  const verdict = parts.length ? `${said[0].toUpperCase()}${said.slice(1)}.` : 'Elles se valent : choisis au paysage.'
  return { rows, verdict }
}
