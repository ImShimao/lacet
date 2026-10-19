// Persistance locale. Tout tient sur le téléphone, sans compte ni serveur :
// le stockage de la WebView, doublé d'une copie sur fichier (plus bas). Chaque
// accès est protégé : le stockage peut être refusé ou plein, et l'app doit
// continuer de fonctionner sans.

import { haversineM } from './engine/geo'

const KEY = 'lacet.v1'

const DEFAULTS = { favorites: [], history: [], params: null, recentPlaces: [], reports: [] }

// Assez pour retrouver chez soi, le travail, le coin du dimanche et deux
// endroits de vacances. Au-delà, la liste demanderait à être lue.
const RECENT_MAX = 5
// Deux départs à moins de ça sont le même endroit : on ne garde pas deux fois
// la même place de village parce qu'on a cliqué à trois mètres près.
const SAME_START_M = 200

/**
 * Se souvenir d'un départ choisi.
 *
 * On revient courir aux mêmes endroits, et on retapait le même nom à chaque
 * fois — parfois sans réseau, là où la recherche ne répond pas. Ce qui est
 * gardé tient en quatre nombres et deux mots : de quoi repartir d'un geste.
 */
export function rememberPlace(place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return
  const kept = {
    label: place.label || place.short || '',
    sub: place.sub || '',
    lat: place.lat,
    lon: place.lon,
    at: Date.now(),
  }
  // La rue de l'adresse, quand on l'a : c'est sur elle qu'on sortira.
  if (place.street) kept.street = place.street
  if (!kept.label) return
  const others = (load().recentPlaces || []).filter(
    (other) => haversineM([other.lon, other.lat], [kept.lon, kept.lat]) > SAME_START_M,
  )
  save({ recentPlaces: [kept, ...others].slice(0, RECENT_MAX) })
}

/** Les départs déjà choisis, du plus récent au plus ancien. */
export const recentPlaces = () => load().recentPlaces || []


export function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * Écrit dans le stockage local, en faisant de la place si nécessaire.
 *
 * Le quota du navigateur (~5 Mo) finit par être atteint : chaque parcours
 * conservé pèse quelques dizaines de kilooctets, et l'historique s'accumule.
 * Échouer en silence ferait disparaître un favori sans que personne le sache —
 * on préfère sacrifier les sorties les plus anciennes, qui ont le moins de
 * valeur, et prévenir seulement si même ça ne suffit pas.
 */
export function save(patch) {
  let next = { ...load(), ...patch }
  const avant = (next.history || []).length

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const text = JSON.stringify(next)
      localStorage.setItem(KEY, text)
      mirrorSoon(text)
      return next
    } catch {
      const history = next.history || []
      if (history.length <= 5) break
      // **Et on le note.** Sacrifier des sorties pour faire de la place est
      // défendable ; le faire sans que personne l'apprenne ne l'est pas. Le
      // seul signal était un message dans une console que personne n'ouvre sur
      // un téléphone, et l'on découvrait le trou des semaines plus tard, sans
      // pouvoir le relier à quoi que ce soit. La trace de l'élagage part avec
      // l'écriture suivante — celle qui, elle, passera.
      next = {
        ...next,
        history: history.slice(0, Math.floor(history.length / 2)),
        trimmed: { at: Date.now(), from: avant, to: Math.floor(history.length / 2) },
      }
    }
  }

  // Même élagué, rien ne passe : la modification est perdue. Il n'y a alors
  // plus de disque où noter l'échec — c'est justement le problème —, donc on le
  // garde en mémoire, le temps de la session, pour que « Mon compte » puisse le
  // dire au lieu de laisser croire que tout va bien.
  refusedAt = Date.now()
  console.warn('Lacet — stockage local saturé, la dernière modification n’a pas été gardée.')
  return load()
}

let refusedAt = null

/**
 * Remet le magasin à neuf : favoris, sorties, départs nommés et récents,
 * signalements, contact d'urgence, réglages — tout.
 *
 * « Tout effacer » ne vidait que les favoris et les sorties : « Chez moi »,
 * avec ses coordonnées, et le numéro du contact d'urgence survivaient au
 * bouton qui annonçait l'app « comme au premier jour ».
 *
 * Le magasin est **réécrit à vide, pas retiré** : absent, il serait restauré
 * au lancement suivant depuis sa copie sur fichier (`restoreFrom`), et tout
 * reviendrait.
 */
export function wipe() {
  try {
    const text = JSON.stringify(DEFAULTS)
    localStorage.setItem(KEY, text)
    mirrorSoon(text)
  } catch {
    /* stockage refusé : il n'y avait rien d'écrit */
  }
}

// --- la copie sur fichier -------------------------------------------------------
//
// iOS peut vider le stockage d'une WebView quand le téléphone manque de place :
// la documentation de Capacitor demande de le tenir pour temporaire. Or c'est là
// que vivent l'historique des sorties et les favoris — ce qu'on ne refait pas.
// Chaque écriture est donc recopiée, un instant plus tard, dans un fichier de
// l'app (`native.js`), et relue au lancement si le stockage est revenu vide.

// Les écritures arrivent en rafale — régler un filtre en fait plusieurs de
// suite — et une seule copie suffit.
const MIRROR_DELAY_MS = 1000
let mirror = null
let mirrorTimer = null

function mirrorSoon(text) {
  if (!mirror) return
  clearTimeout(mirrorTimer)
  mirrorTimer = setTimeout(() => mirror(text), MIRROR_DELAY_MS)
}

/**
 * Branche la copie sur fichier : `write(texte)` reçoit le magasin entier.
 *
 * Le magasin du moment est recopié tout de suite : sans ça, une installation
 * mise à jour n'aurait de copie qu'à sa première écriture, et rien ne protégeait
 * l'historique d'ici là.
 */
export function mirrorTo(write) {
  mirror = write
  try {
    const text = localStorage.getItem(KEY)
    if (text) mirrorSoon(text)
  } catch {
    /* stockage refusé : rien à recopier */
  }
}

/**
 * Remet le magasin en place depuis sa copie, s'il a disparu. Rend `true` si
 * c'est le cas. `read()` rend le texte de la copie, ou `null`.
 *
 * Un magasin présent n'est jamais remplacé : c'est lui le plus récent.
 */
export async function restoreFrom(read) {
  try {
    if (localStorage.getItem(KEY) !== null) return false
  } catch {
    return false
  }
  const text = await read()
  if (!text) return false
  try {
    JSON.parse(text)
    localStorage.setItem(KEY, text)
    return true
  } catch {
    return false
  }
}

// Ce que le navigateur accorde à une origine, en pratique : cinq mégaoctets,
// chez Chrome comme chez Safari. Approximatif par nature — c'est un ordre de
// grandeur affiché comme tel, pas une promesse.
export const QUOTA_BYTES = 5 * 1024 * 1024

/**
 * Le poids de ce qui est gardé, et de quoi il est fait.
 *
 * **Chaque caractère compte double.** Les navigateurs gardent ces chaînes en
 * UTF-16 et décomptent deux octets par caractère du quota : un magasin de trois
 * millions de caractères en occupe six mégaoctets, et dépasse donc une limite
 * qu'on croyait loin. C'est cette mesure-là qui est rendue, pas la longueur du
 * texte, sans quoi la jauge annoncerait la moitié de la vérité.
 */
export function usage() {
  let brut = ''
  try {
    brut = localStorage.getItem(KEY) || ''
  } catch {
    return null
  }
  const data = load()
  const poids = (valeur) => (valeur === undefined ? 0 : JSON.stringify(valeur ?? null).length * 2)
  const history = data.history || []
  return {
    bytes: brut.length * 2,
    quota: QUOTA_BYTES,
    parts: {
      favorites: poids(data.favorites),
      history: poids(history),
      traces: history.reduce((somme, sortie) => somme + poids(sortie.track), 0),
    },
    counts: {
      favorites: (data.favorites || []).length,
      history: history.length,
      traces: history.filter((sortie) => sortie.track?.length).length,
    },
    trimmed: data.trimmed ?? null,
    // Une écriture refusée pendant cette session, élagage compris : ce qui
    // vient d'être fait n'a pas été gardé.
    refusedAt,
  }
}

/** Efface la trace d'un élagage, une fois qu'on l'a lue. */
export const forgetTrim = () => save({ trimmed: null })

/**
 * Retire les traces GPS gardées avec les sorties, et rend les octets libérés.
 *
 * C'est le seul allègement qui ne perd aucun chiffre : distance, temps, allure,
 * tours de kilomètre et parcours prévu restent. Ce qui part, c'est le dessin de
 * ce qu'on a réellement couru — qu'on ne reverra plus sur la carte, et qu'on ne
 * pourra plus exporter —, et le journal de ce que la voix y a dit.
 */
export function dropTracks() {
  const data = load()
  const avant = usage()?.bytes ?? 0
  const allegee = (sortie) => (sortie.track || sortie.spoken ? { ...sortie, track: null, spoken: null } : sortie)
  save({ history: (data.history || []).map(allegee) })
  return Math.max(0, avant - (usage()?.bytes ?? 0))
}

/**
 * Version allégée d'un itinéraire, pour le stockage local.
 *
 * On garde tout ce qui se lit — profil, sécurité, revêtements — mais **pas les
 * coordonnées de chaque tronçon** : sur un parcours de 10 km elles pèsent à
 * elles seules plusieurs centaines de kilooctets, et quelques favoris
 * suffiraient à saturer le stockage du navigateur. Conséquence assumée : un
 * parcours rouvert depuis les favoris s'affiche d'un seul tenant sur la carte
 * au lieu d'être colorié tronçon par tronçon. Le détail, lui, reste complet.
 */
export function slim(route) {
  return {
    id: route.id,
    name: route.name,
    distance_m: route.distance_m,
    duration_s: route.duration_s,
    ascent_m: route.ascent_m,
    descent_m: route.descent_m,
    grade: route.safety?.grade ?? null,
    safety: route.safety,
    surfaces: route.surfaces,
    crossings: route.crossings,
    elevation_profile: route.elevation_profile,
    // Les consignes sont gardées : sans elles, un favori relancé perd le
    // guidage vocal, et l'écran reste sur « en attente du signal GPS » sans
    // jamais rien dire. Elles pèsent quelques kilooctets, contre plusieurs
    // centaines pour la géométrie — que l'on garde déjà.
    instructions: route.instructions,
    direction: route.direction,
    bearing: route.bearing,
    shape: route.shape,
    roundness: route.roundness,
    // Un parcours à tours oublié en favori devenait une boucle simple : plus de
    // compteur de tours pendant la sortie, et une longueur de tour absente de
    // la carte. Deux nombres suffisent à le restituer.
    laps: route.laps ?? 1,
    lap_distance_m: route.lap_distance_m ?? route.distance_m,
    // Un « 8 » : ses deux boucles, chacune de sa longueur — voir `figure_eight`.
    lap_distances_m: route.lap_distances_m,
    figure_eight: route.figure_eight ?? false,
    segments: (route.segments || []).map((s) => ({
      length_m: s.length_m,
      level: s.level,
      surface: s.surface,
      road: s.road,
    })),
    geometry: route.geometry,
    // Un parcours venu d'un fichier ne sera jamais noté : le rouvrir doit le
    // dire, sinon l'absence de note passerait pour un calcul qui a échoué.
    imported: route.imported || undefined,
    savedAt: new Date().toISOString(),
  }
}

/**
 * Toutes les données locales, en un fichier.
 *
 * Elles ne vivent que dans cet appareil : supprimer l'app — ce que demande
 * parfois une réinstallation — les emporte. Une sauvegarde à soi, qu'on garde
 * où l'on veut, évite d'avoir à choisir entre réinstaller et garder ses
 * parcours.
 */
export function exportAll() {
  const data = load()
  return JSON.stringify({ app: 'lacet', v: 1, savedAt: new Date().toISOString(), data }, null, 2)
}

/**
 * Remet une sauvegarde en place. Rend le nombre de parcours et de sorties
 * retrouvés, ou lève si le fichier n'en est pas une.
 *
 * Les listes sont **fusionnées**, pas remplacées : restaurer après avoir
 * recouru ne doit pas effacer les sorties faites entre-temps.
 */
export function importAll(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("Ce fichier n'est pas une sauvegarde Lacet.")
  }
  const lu = parsed?.app === 'lacet' ? parsed.data : null
  if (!lu || typeof lu !== 'object') throw new Error("Ce fichier n'est pas une sauvegarde Lacet.")
  // Ce qui décrit l'appareil d'où vient la sauvegarde, et pas ses données : la
  // liste des cartes hors ligne — dont les fichiers sont restés là-bas, et que
  // l'app aurait annoncées « disponibles » sur un téléphone réinstallé —, une
  // sortie en cours, la trace d'un élagage.
  const { offlineMaps, run, trimmed, ...data } = lu

  const current = load()
  const merge = (mine, theirs, key) => {
    const out = [...(theirs || [])]
    const seen = new Set(out.map(key))
    for (const item of mine || []) {
      if (!seen.has(key(item))) out.push(item)
    }
    return out
  }
  const favorites = merge(current.favorites, data.favorites, (r) => `${r.id}|${r.distance_m}`)
  const history = merge(current.history, data.history, (r) => r.ranAt || `${r.id}`)
  const reports = merge(current.reports, data.reports, (r) => r.id)
  // Les zones à éviter de même : une zone dessinée depuis ne doit pas disparaître.
  const zones = merge(current.zones, data.zones, (z) => z.id)
  // Les départs nommés aussi : « Chez moi » enregistré depuis la sauvegarde
  // ne doit pas disparaître parce qu'elle ne le connaissait pas.
  const places = merge(current.places, data.places, (p) => p.id ?? `${p.name}|${p.lat}|${p.lon}`)
  history.sort((a, b) => String(b.ranAt || '').localeCompare(String(a.ranAt || '')))

  save({
    ...data,
    favorites: favorites.slice(0, 40),
    history: history.slice(0, 200),
    reports: reports.slice(0, 200),
    zones: zones.slice(0, 30),
    places: places.slice(0, 8),
  })
  return { favorites: favorites.length, history: history.length }
}

