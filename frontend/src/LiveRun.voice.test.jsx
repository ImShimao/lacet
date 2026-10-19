/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromCompact } from './engine/extract'
import { buildGraph } from './engine/graph'
import { planLoops } from './engine/service'
import { haversine } from './format'
import { bearing, buildTrack, headingAt, locate, pointAt } from './routeTracker'
import { save } from './storage'

/**
 * Une sortie entière, écoutée du départ à l'arrivée.
 *
 * La plainte n° 1 contre les apps de course concurrentes, dans les avis de
 * l'App Store : une voix qui se tait au bout de quelques virages, écran
 * verrouillé, ou qui annonce un virage déjà passé. Chaque morceau du guidage
 * de Lacet a ses tests — la phrase (`guidance.test.js`), la projection sur le
 * tracé (`routeTracker.test.js`), l'arrivée (`arrival.test.js`) —, mais rien
 * ne prouvait qu'une sortie complète est guidée sans trou.
 *
 * Ici, une trace GPS simulée parcourt **toute** une boucle réelle des extraits
 * de parité, à allure de course : un relevé par seconde, la dérive d'un GPS de
 * téléphone, des reflets sur les façades donnés pour précis, des points que le
 * téléphone sait douteux. Elle passe par le vrai chemin — `LiveRun.jsx`,
 * `guidance.js`, `voice.js`, `native.js` —, jusqu'au module natif, remplacé par
 * une synthèse qui suit les règles de `VoicePlugin.swift` : une phrase prend le
 * temps de se dire, une consigne prioritaire coupe celle en cours et vide la
 * file, les autres attendent leur tour, la musique remonte quand la voix s'est
 * tue. On juge ce qu'on **entend**, pas ce que le code a voulu dire.
 *
 * Trois défauts réels en sont sortis, corrigés depuis : un seul reflet faisait
 * dire « Tu reviens sur tes pas » et taisait les consignes (`locate`, qui
 * cherchait à deux cent cinquante mètres de part et d'autre, une minute de
 * course) ; un écart à quarante mètres du tracé faisait de même au retour
 * (`ON_LINE_M`) ; et un reflet comptait pour soixante à cent mètres courus,
 * si bien que « Premier kilomètre » tombait à sept cents (`JUMP_SLACK_M`).
 */

let fixes = null
vi.mock('./position', () => ({
  watchPosition: (ok) => {
    fixes = ok
    return () => {
      fixes = null
    }
  },
}))
vi.mock('./platform', () => ({ isNative: () => false }))
// Aucun nouveau chemin trouvé : l'écart se rattrape seul, sur le tracé d'origine.
vi.mock('./engine/client', () => ({ detourOnDevice: vi.fn(async () => null) }))
vi.mock('./runState', () => ({ saveRun: vi.fn(), clearRun: vi.fn() }))

// La voix d'iOS, telle que la pilote `VoicePlugin.swift`.
const synthese = vi.hoisted(() => {
  // Le débit de la voix française d'iOS au réglage de l'app : une quinzaine de
  // caractères par seconde. Pris un peu bas : une voix plus lente se fait
  // couper plus souvent, et c'est ce cas-là qu'on veut voir.
  const PAR_SECONDE = 14
  // `leadIn` et `tail` de `VoicePlugin.swift`.
  const AVANT_MS = 200
  const APRES_MS = 350

  let parle = null
  let file = []
  let dites = []
  let remonte = null
  let musique = []

  const duree = (texte) => (texte.length / PAR_SECONDE) * 1000
  const commence = (phrase, t) => {
    phrase.debut = t + AVANT_MS
    phrase.fin = phrase.debut + duree(phrase.texte)
    parle = phrase
  }
  const termine = (phrase, t, coupee) => {
    const fin = Math.max(phrase.debut ?? t, Math.min(t, phrase.fin ?? t))
    const entendu = phrase.debut == null ? 0 : Math.floor(((fin - phrase.debut) / 1000) * PAR_SECONDE)
    dites.push({ ...phrase, fin, coupee, entendu: coupee ? Math.min(entendu, phrase.texte.length) : phrase.texte.length })
  }
  const basse = (t) => {
    if (musique.at(-1)?.basse !== true) musique.push({ t, basse: true })
  }
  const haute = (t) => {
    if (musique.at(-1)?.basse === true) musique.push({ t, basse: false })
  }

  /** Fait avancer la synthèse jusqu'à `t` : fins de phrase, phrases en file, musique. */
  function avance(t) {
    for (;;) {
      if (parle && parle.fin <= t) {
        const fin = parle.fin
        termine(parle, fin, false)
        parle = null
        const suivante = file.shift()
        if (suivante) commence(suivante, fin)
        // `didFinish` : la musique remonte un peu après, si rien ne parle plus.
        else remonte = fin + APRES_MS
        continue
      }
      if (!parle && remonte != null && remonte <= t) {
        haute(remonte)
        remonte = null
      }
      return
    }
  }

  /** `stopSpeaking(at: .immediate)` : la phrase en cours et toute la file. */
  function coupe(t) {
    if (parle) termine(parle, t, true)
    for (const phrase of file) termine(phrase, t, true)
    parle = null
    file = []
  }

  const plugin = {
    async speak({ text, flush = true }) {
      const t = Date.now()
      avance(t)
      if (!text) return
      if (flush) coupe(t)
      // `lowerOthers` annule le retour de la musique programmé.
      remonte = null
      basse(t)
      const phrase = { texte: text, demande: t, prioritaire: flush }
      if (parle) file.push(phrase)
      else commence(phrase, t)
    },
    async stop() {
      const t = Date.now()
      avance(t)
      coupe(t)
      remonte = t + 100
    },
  }

  return {
    plugin,
    avance,
    parSeconde: PAR_SECONDE,
    reset() {
      parle = null
      file = []
      dites = []
      remonte = null
      musique = []
    },
    get dites() {
      return dites
    },
    get musique() {
      return musique
    },
  }
})

vi.mock('@capacitor/core', async (importOriginal) => {
  const core = await importOriginal()
  return {
    ...core,
    registerPlugin: (name, impl) => (name === 'Voice' ? synthese.plugin : core.registerPlugin(name, impl)),
  }
})

const LiveRun = (await import('./LiveRun.jsx')).default
// Chargé d'avance : `voice.js` l'importe à la première phrase, et un import
// encore en cours décalerait l'heure où la synthèse reçoit la phrase.
await import('./native')

// Un chemin, pas une URL : sous jsdom, `URL` n'est plus celle de Node, et `fs` la refuse.
const dir = join(import.meta.dirname, 'engine', '__fixtures__', 'parity')
const graphes = new Map()
const graphe = (nom) => {
  if (!graphes.has(nom)) {
    const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(join(dir, nom))).toString('utf8')))
    graphes.set(nom, buildGraph(extract, { sport: 'run' }))
  }
  return graphes.get(nom)
}

// Les départs de `navigation.test.js`.
const BEAUNE = ['extract-beaune.json.gz', 47.0043406, 4.8380759]
const GUILLOTIERE = ['extract-lyon-centre.json.gz', 45.7502885, 4.8579479]
const PENTES = ['extract-lyon-centre.json.gz', 45.772538, 4.8279541]

/** Les boucles proposées d'un départ, avec la demande qui les a produites. */
async function boucles([nom, lat, lon], km) {
  const demande = { lat, lon, distance_km: km, sport: 'run', limit: 12 }
  const graph = graphe(nom)
  const r = await planLoops(demande, {
    loadGraph: async () => graph,
    fetchElevations: async () => [],
    wind: async () => null,
  })
  return { demande, routes: r.routes }
}

/** Un hasard qui se rejoue à l'identique (mulberry32). */
function hasard(graine) {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())

/** Les manœuvres seules : ni le départ, ni les tours, ni l'arrivée. */
const manoeuvres = (route) => route.instructions.filter((s) => !['start', 'finish', 'lap'].includes(s.turn))
const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1)

/**
 * Où s'écarter du tracé : au milieu de la plus longue ligne droite de la
 * première moitié, du côté où rien du tracé ne passe. À angle droit d'un
 * carrefour, on partait le long de la rue suivante — et l'app avait raison
 * de croire qu'on avait pris un raccourci.
 */
function lieuDEcart(route, track) {
  const reperes = route.instructions.map((s) => s.dist_m).filter((d) => d < track.total / 2)
  let best = null
  for (let i = 0; i + 1 < reperes.length; i += 1) {
    const gap = reperes[i + 1] - reperes[i]
    if (!best || gap > best.gap) best = { gap, along: (reperes[i] + reperes[i + 1]) / 2 }
  }
  const kx = 111_320 * Math.cos((route.geometry[0][1] * Math.PI) / 180)
  for (const cote of [90, -90]) {
    const cap = (((headingAt(track, best.along) ?? 0) + cote) * Math.PI) / 180
    const [lon, lat] = pointAt(track, best.along)
    const loin = [lon + (90 * Math.sin(cap)) / kx, lat + (90 * Math.cos(cap)) / 110_540]
    if (locate(track, loin, null).offset > 70) return { along: best.along, cote }
  }
  throw new Error(`pas d'écart possible sur ${route.name}`)
}

/**
 * Court toute la boucle, un relevé par seconde, et rend ce que la voix a dit.
 *
 * `ecart` : s'écarter du tracé, à angle droit, trente secondes à l'aller et
 * trente au retour — une fontaine, une rue barrée qu'on contourne. Plus de
 * quarante-cinq mètres du tracé pendant une demi-minute.
 */
async function courir(route, demande, { graine = 1, ecart = false } = {}) {
  const r = hasard(graine)
  const track = buildTrack(route.geometry)
  const total = track.total
  const kx = 111_320 * Math.cos((route.geometry[0][1] * Math.PI) / 180)
  const decale = ([lon, lat], est, nord) => [lon + est / kx, lat + nord / 110_540]
  const lieu = ecart ? lieuDEcart(route, track) : null
  const onStop = vi.fn()

  synthese.reset()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-10-18T08:00:00Z'))
  const t0 = Date.now()
  render(
    <LiveRun route={route} request={demande} sport="run" speaking stage={null} onPosition={() => {}} onStop={onStop} />,
  )

  // L'avancée réelle sur le tracé, seconde par seconde : c'est elle qui juge
  // les consignes. Et ce qu'on a réellement couru, écart compris : c'est lui
  // qui juge les bornes kilométriques.
  const verite = [0]
  const couru = [0]
  const places = [route.geometry[0]]
  let along = 0
  let ecarte = 0
  let derive = [0, 0]
  let cap = 0
  let avant = null
  // Un coureur ne suit pas le tracé au mètre près : il coupe les angles, et
  // ignore les détours de trois mètres qu'OpenStreetMap dessine autour d'un
  // îlot, au pied d'une passerelle. Sa place est la moyenne du tracé sur six
  // mètres de part et d'autre. Passé l'arrivée, il continue sur le début de la
  // boucle : il s'éloigne de la porte.
  const surBoucle = (a) => pointAt(track, a > total ? a - total : Math.max(0, a))
  const coureur = (a) => {
    const autour = [-6, -3, 0, 3, 6].map((k) => surBoucle(a + k))
    return [0, 1].map((x) => autour.reduce((somme, p) => somme + p[x], 0) / autour.length)
  }
  // Jusqu'à l'arrivée — ou, si elle ne vient pas, une fois et demie la boucle.
  for (let s = 1; !onStop.mock.calls.length && along < 1.5 * total; s += 1) {
    const v = 2.9 + 0.3 * Math.sin(s / 97)
    let point
    if (lieu && along >= lieu.along && ecarte < 60) {
      ecarte += 1
      const loin = v * (ecarte <= 30 ? ecarte : 60 - ecarte)
      const vers = (headingAt(track, along) ?? 0) + lieu.cote
      point = decale(coureur(along), loin * Math.sin((vers * Math.PI) / 180), loin * Math.cos((vers * Math.PI) / 180))
      // On s'éloigne, puis on revient.
      cap = ecarte <= 30 ? vers : vers + 180
    } else {
      along += v
      point = coureur(along)
      cap = bearing(coureur(along - 3), coureur(along + 3))
    }
    verite.push(along)
    places.push(point)
    couru.push(couru.at(-1) + (avant ? haversine(avant, point) : 0))
    avant = point

    // L'erreur d'un GPS de téléphone dérive lentement, elle ne saute pas d'un
    // relevé à l'autre : iOS lisse ses positions. Tirée au hasard à chaque
    // seconde, elle aurait doublé la distance mesurée — trois mètres de
    // tremblement pour trois mètres courus. Quatre mètres d'écart type, qui
    // changent en une minute.
    derive = derive.map((e) => e * 0.98 + gauss(r) * 4 * Math.sqrt(1 - 0.98 ** 2))
    let accuracy = 5
    let [est, nord] = derive
    const tirage = r()
    if (tirage < 1 / 90) {
      // Un reflet sur une façade : loin, et donné pour précis.
      const angle = r() * 2 * Math.PI
      const d = 60 + 80 * r()
      ;[est, nord] = [d * Math.sin(angle), d * Math.cos(angle)]
      accuracy = 8
    } else if (tirage < 1 / 90 + 1 / 120) {
      // Celui-là, le téléphone le sait douteux.
      est += 30
      accuracy = 60
    }
    const [longitude, latitude] = decale(point, est, nord)
    // Le cap, qu'iOS tire de la vitesse et non des positions : à quelques
    // degrés près, et juste même quand la position est un reflet.
    const heading = (((cap + gauss(r) * 5) % 360) + 360) % 360

    await act(async () => {
      vi.advanceTimersByTime(1000)
      fixes({
        coords: { longitude, latitude, accuracy, altitude: null, altitudeAccuracy: null, speed: v, heading },
        timestamp: Date.now(),
      })
      // Toutes les promesses en attente, dont celle de `voice.js` : la phrase
      // part à l'heure du relevé qui l'a décidée (`setImmediate` n'est pas simulé).
      await new Promise((ok) => setImmediate(ok))
    })
  }
  // L'arrivée rend l'app au bilan, et l'écran de course disparaît — comme
  // dans `useRunSession`. Puis le temps que la dernière phrase se dise.
  await act(async () => {
    cleanup()
    await new Promise((ok) => setImmediate(ok))
  })
  synthese.avance(Date.now() + 60_000)
  vi.useRealTimers()

  const seconde = (t) => Math.max(0, Math.min(verite.length - 1, Math.round((t - t0) / 1000)))
  const alongAt = (t) => verite[seconde(t)]
  const couruA = (t) => couru[seconde(t)]
  const placeA = (t) => places[seconde(t)]
  return { dites: synthese.dites.slice(), musique: synthese.musique.slice(), onStop, alongAt, couruA, placeA, total, t0, lieu }
}

/** Ce qu'on a entendu, une ligne par phrase : la seconde, l'avancée réelle, le texte. */
function transcription(run) {
  return run.dites
    .map((d) => {
      const coupe = d.coupee ? ` [coupée à ${d.entendu}/${d.texte.length}]` : ''
      return `${Math.round((d.demande - run.t0) / 1000)} s · ${Math.round(run.alongAt(d.demande))} m · ${d.texte}${coupe}`
    })
    .join('\n')
}

// « Maintenant » arrive au plus cinquante mètres avant le carrefour
// (`ACT_MAX_M`, dans `guidance.js`), quinze à pied, et sa direction — « tourne
// à gauche » — doit avoir été entendue au plus tard en le traversant. Quinze
// mètres de marge : trois écarts types de la dérive du GPS le long de la rue.
// Un « maintenant » dit au carrefour même, et non avant, les dépasserait une
// fois sur deux.
const ACT_AVANT_M = 60
const ACT_APRES_M = 15
// À moins de quarante mètres du virage d'avant, une annonce n'a pas le temps
// d'être dite : elle vient dans la phrase de celui-ci (« …, puis dans 30
// mètres, à droite »), et quand cette phrase dit déjà deux virages — « serre
// à gauche puis tout de suite à droite » — et cent cinquante caractères —, le
// « maintenant » du troisième la coupe avant qu'elle y arrive. On exige alors
// qu'elle soit dans la phrase, pas qu'elle ait été entendue.
const SERRE_M = 40
// L'annonce, jusqu'à 350 m avant (`PREVIEW_MAX_M`), et sa distance dite à
// l'arrondi près — cinquante mètres au-delà de cent vingt — et au GPS près.
const ANNONCE_AVANT_M = 400
const ANNONCE_ECART_M = 40
// Les bornes kilométriques : la distance mesurée sur une trace GPS dépasse un
// peu celle qu'on a courue — jusqu'à 4,5 % ici, du tremblement du GPS d'une
// seconde à l'autre. Un reflet compté pour couru, lui, faisait 30 %.
const BORNE_ECART_M = 30
const BORNE_PART = 0.05
// Une voix qui parle sans arrêt : la musique ne remonte jamais. Dans les
// lacets de la Croix-Rousse, trois virages d'affilée se disent en vingt
// secondes ; au-delà de trente, la voix ne se tait plus.
const SOURDINE_MS = 30_000
// L'arrivée ne s'arme que sur les derniers mètres du tracé (`LEFT_M`, dans
// `arrival.js`).
const LEFT_M = 120

/** La distance dite dans « Dans 250 mètres, … », en mètres. */
function distanceDite(texte) {
  const m = texte.match(/^Dans (\d+(?:,\d+)?) (mètres|kilomètres?),/)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return m[2] === 'mètres' ? n : n * 1000
}

/**
 * Tout ce qui cloche dans ce qu'on a entendu, en clair — une liste vide quand
 * la sortie a été guidée du premier au dernier mètre.
 */
function defauts(route, run, { km = 1, avance = 1 } = {}) {
  const out = []
  const { dites, alongAt } = run
  const at = (d) => alongAt(d.demande)
  // Une annonce réglée plus tôt (`LEAD`, dans `voice.js`) vise plus loin.
  const annonceAvant = ANNONCE_AVANT_M * Math.max(1, avance)
  // Le moment où une phrase a fini de dire ses `n` premiers caractères.
  const ditJusqua = (d, n) => d.debut + (n / synthese.parSeconde) * 1000
  // Arrivé devant sa porte, on est rentré, même si le tracé la dépasse pour y
  // revenir par un demi-tour : ce qui suit peut ne plus se dire.
  const arrivees = dites.filter((d) => d.texte.startsWith('Arrivée. Sortie terminée'))
  const rentre = arrivees.length ? at(arrivees[0]) : Infinity
  const pas = manoeuvres(route)

  // **Chaque manœuvre, « maintenant », dans l'ordre, sans en sauter une.**
  const maintenant = dites.filter((d) => d.texte.startsWith('Maintenant'))
  let suite = 0
  let precedente = dites.find((d) => d.texte.startsWith('Départ'))
  if (!precedente) out.push('le départ n’a pas été dit')
  else if (precedente.coupee) out.push(`le départ a été coupé : ${precedente.texte}`)
  // La suite dite dans la foulée d'une phrase — « …, puis dans 60 mètres, à
  // gauche » —, si elle a été entendue.
  const ditLaSuite = (d, re, assez = 20) => {
    const at = d ? d.texte.search(re) : -1
    return at >= 0 && d.entendu >= at + assez
  }
  // Les fins de tour, et la phrase qui les a dites : « Fin du premier tour.
  // Dernier tour. Repars vers le sud, puis dans 80 mètres, à droite. »
  const sansPoint = (text) => text.replace(/[.\s]+$/, '')
  const tours = route.instructions
    .filter((s) => s.turn === 'lap')
    .map((step) => ({
      step,
      dite: dites.find((d) => d.texte.startsWith(sansPoint(step.text)) && Math.abs(at(d) - step.dist_m) <= ACT_AVANT_M),
    }))
  pas.forEach((step, k) => {
    const rang = `${k + 1}ᵉ manœuvre (${Math.round(step.dist_m)} m, « ${step.text} »)`
    // Juste après une fin de tour, c'est elle, la phrase d'avant.
    const tour = tours.find((t) => t.step.dist_m < step.dist_m && t.step.dist_m > (pas[k - 1]?.dist_m ?? 0))
    if (tour) precedente = tour.dite ?? null
    const consigne = `Maintenant, ${lower(step.text)}`
    // La décision, sans la rue ni la suite : « Maintenant, tourne à gauche ».
    // C'est elle qu'il faut avoir entendue en arrivant au carrefour.
    const direction = consigne.split(/ (?:dans|sur|puis) /)[0]
    // Dite « tout de suite » avec la précédente, et entendue : c'est là
    // qu'elle a été dite à temps — sa phrase à elle attend la fin de l'autre.
    const toutDeSuite = ditLaSuite(precedente, /, puis tout de suite/)
    const j = maintenant.findIndex(
      (d, i) =>
        i >= suite &&
        d.texte.startsWith(consigne) &&
        at(d) >= step.dist_m - ACT_AVANT_M &&
        at(d) <= step.dist_m + ACT_APRES_M,
    )
    if (j < 0) {
      if (!toutDeSuite && step.dist_m < rentre) out.push(`${rang} : jamais dite au carrefour`)
      precedente = null
      return
    }
    for (const enTrop of maintenant.slice(suite, j)) out.push(`consigne en trop avant la ${rang} : ${enTrop.texte}`)
    suite = j + 1
    const dite = maintenant[j]
    const entendueA = alongAt(ditJusqua(dite, direction.length))
    if (toutDeSuite) {
      // Déjà dite : sa phrase à elle n'est qu'un rappel.
    } else if (dite.entendu < direction.length) out.push(`${rang} : coupée avant « ${direction} » (${dite.entendu})`)
    else if (entendueA > step.dist_m + ACT_APRES_M) {
      out.push(`${rang} : « ${direction} » fini de dire ${Math.round(entendueA - step.dist_m)} m après le carrefour`)
    }

    // **Annoncée à l'avance** : par sa phrase à elle, ou dans la foulée de la
    // précédente.
    const texte = lower(step.text)
    const annonce = dites.find(
      (d) =>
        d.texte.startsWith('Dans ') &&
        d.texte.includes(`, ${texte}`) &&
        at(d) < step.dist_m &&
        at(d) >= step.dist_m - annonceAvant,
    )
    const serree = step.dist_m - (pas[k - 1]?.dist_m ?? 0) <= SERRE_M
    const enchainee = ditLaSuite(precedente, /, puis (tout de suite|dans \d)/, serree ? -Infinity : 20)
    if (annonce && annonce.entendu < annonce.texte.indexOf(texte) + texte.length && !enchainee) {
      out.push(`${rang} : annonce coupée (${annonce.entendu}/${annonce.texte.length})`)
    } else if (!annonce && !enchainee) out.push(`${rang} : jamais annoncée à l'avance`)
    precedente = dite
  })
  for (const enTrop of maintenant.slice(suite)) out.push(`consigne en trop après la dernière manœuvre : ${enTrop.texte}`)

  // **Aucune annonce périmée** : chacune vise un carrefour encore devant, à la
  // distance qu'elle dit.
  for (const d of dites.filter((x) => x.texte.startsWith('Dans '))) {
    const vise = pas.find(
      (step) =>
        d.texte.includes(`, ${lower(step.text)}`) && step.dist_m >= at(d) && step.dist_m - at(d) <= annonceAvant,
    )
    if (!vise) out.push(`annonce sans carrefour devant soi, à ${Math.round(at(d))} m : ${d.texte}`)
    else if (Math.abs(distanceDite(d.texte) - (vise.dist_m - at(d))) > ANNONCE_ECART_M) {
      out.push(`annonce à ${Math.round(vise.dist_m - at(d))} m réels : ${d.texte}`)
    }
  }

  // **Les fins de tour**, au départ, avec la direction où repartir.
  for (const { step, dite } of tours) {
    if (!dite) out.push(`fin de tour jamais dite (${Math.round(step.dist_m)} m) : ${step.text}`)
    else if (dite.entendu < sansPoint(step.text).length) out.push(`fin de tour coupée : ${dite.texte}`)
  }

  // **L'arrivée** : annoncée, puis dite une fois, au bout de la boucle.
  if (!dites.some((d) => /arrivée dans|tu arrives/i.test(d.texte) && at(d) < run.total)) {
    out.push('l’arrivée n’a pas été annoncée')
  }
  const porte = haversine(run.placeA(arrivees[0]?.demande ?? 0), route.geometry.at(-1))
  if (arrivees.length !== 1) out.push(`arrivée dite ${arrivees.length} fois`)
  else if (arrivees[0].coupee) out.push(`arrivée coupée à ${arrivees[0].entendu}/${arrivees[0].texte.length}`)
  else if (porte > 30 || run.total - rentre > LEFT_M) {
    out.push(`arrivée dite à ${Math.round(rentre)} m sur ${Math.round(run.total)}, à ${Math.round(porte)} m de la porte`)
  }
  if (run.onStop.mock.calls.length !== 1) out.push(`sortie terminée ${run.onStop.mock.calls.length} fois`)

  // **Les bornes** : « Troisième kilomètre » au troisième kilomètre, pas à
  // deux mille cinq cents mètres parce qu'un reflet a compté pour cent.
  const bornes = dites.filter((x) => /^[^,]+ kilomètre(?: à|\.)/.test(x.texte) && !/^(Dans|Maintenant)/.test(x.texte))
  // Réglées une sur deux, au deuxième, au quatrième ; tues, jamais.
  if (!km && bornes.length) out.push(`bornes dites alors qu'elles sont tues : ${bornes[0].texte}`)
  bornes.forEach((d, i) => {
    const m = run.couruA(d.demande)
    if (Math.abs(m - (i + 1) * 1000 * km) > BORNE_ECART_M + BORNE_PART * m) {
      out.push(`borne ${i + 1} dite à ${Math.round(m)} m courus : ${d.texte}`)
    }
  })

  // **Rien de faux** : pas de demi-tour qu'on n'a pas fait, pas de pause.
  for (const d of dites.filter((x) => /^(Tu reviens sur tes pas|Tu pars à contresens|Pause automatique)/.test(x.texte))) {
    out.push(`dit à ${Math.round(at(d))} m sans raison : ${d.texte}`)
  }

  // **La musique remonte** après chaque phrase : jamais plus de trente secondes
  // de suite en sourdine, et rendue à la fin.
  const { musique } = run
  if (musique.at(-1)?.basse) out.push('la musique reste en sourdine après la dernière phrase')
  for (let i = 0; i < musique.length; i += 1) {
    const fin = musique[i + 1]?.t ?? Infinity
    if (musique[i].basse && fin - musique[i].t > SOURDINE_MS) {
      out.push(`musique en sourdine ${Math.round((fin - musique[i].t) / 1000)} s à partir de ${Math.round(alongAt(musique[i].t))} m`)
    }
  }
  return out
}

afterEach(() => {
  localStorage.clear()
  cleanup()
  vi.useRealTimers()
})

describe('une sortie entière, écoutée', () => {
  // Une boucle entière de chaque départ : la première proposée, et aux pentes
  // de la Croix-Rousse la plus chargée — c'est là que les virages se suivent à
  // trente mètres, et qu'une voix qui décroche se remarque le plus vite.
  const entiere = (routes) => routes.find((r) => r.laps === 1)
  const chargee = (routes) =>
    routes.filter((r) => r.laps === 1).sort((a, b) => manoeuvres(b).length - manoeuvres(a).length)[0]
  const CAS = [
    ['à Beaune', BEAUNE, entiere],
    ['à la Guillotière', GUILLOTIERE, entiere],
    ['sur les pentes de la Croix-Rousse', PENTES, chargee],
  ]

  it.each(CAS)('%s, chaque manœuvre est dite jusqu’à la dernière, malgré un écart', async (_, depart, choisir) => {
    const { demande, routes } = await boucles(depart, 5)
    const route = choisir(routes)
    const run = await courir(route, demande, { ecart: true })
    expect(defauts(route, run).join('\n'), transcription(run)).toBe('')

    // L'écart a bien eu lieu, et s'est dit : on s'écarte, on revient.
    const auLieu = (re) => run.dites.filter((d) => re.test(d.texte) && Math.abs(run.alongAt(d.demande) - run.lieu.along) < 5)
    expect(auLieu(/^Tu t'es écarté/).length, transcription(run)).toBeGreaterThan(0)
    expect(auLieu(/^Te revoilà/).length, transcription(run)).toBeGreaterThan(0)

    // Le journal gardé avec la sortie : chaque phrase partie vers la voix, dans
    // l'ordre, avec son heure, sa position et la distance courue.
    const journal = run.onStop.mock.calls[0][0].spoken
    const parties = [...run.dites].sort((a, b) => a.demande - b.demande).map((d) => d.texte)
    expect(journal.map((s) => s.text)).toEqual(parties)
    expect(journal.every((s) => s.t > run.t0 && Number.isFinite(s.lon) && Number.isFinite(s.lat) && s.m >= 0)).toBe(true)
  }, 60_000)

  it('passe la 5ᵉ, la 10ᵉ et la 30ᵉ manœuvre sur les pentes de la Croix-Rousse', async () => {
    // C'est là que les voix des autres apps se taisent : la boucle la plus
    // chargée, jugée plus haut, en compte plus de trente.
    const { routes } = await boucles(PENTES, 5)
    expect(manoeuvres(chargee(routes)).length).toBeGreaterThan(30)
  }, 60_000)

  it('dit la fin du premier tour, et ne s’arrête pas là', async () => {
    const { demande, routes } = await boucles(BEAUNE, 5)
    const route = routes.find((r) => r.laps === 2 && !r.figure_eight)
    expect(route).toBeTruthy()
    const run = await courir(route, demande)
    expect(defauts(route, run).join('\n'), transcription(run)).toBe('')
  }, 60_000)

  it('dit, à la fin de la première boucle d’un « 8 », de quel côté repartir', async () => {
    const { demande, routes } = await boucles(PENTES, 16)
    const route = routes.find((r) => r.figure_eight)
    expect(route).toBeTruthy()
    const run = await courir(route, demande, { graine: 8 })
    expect(defauts(route, run).join('\n'), transcription(run)).toBe('')
  }, 120_000)
})

describe('la voix réglée', () => {
  // Ce qu'on règle dans « Pendant la sortie » ne touche que le confort : la
  // sortie reste guidée du premier au dernier virage, et l'écart se dit
  // toujours, même kilomètres tus.
  const ecouter = async (voice) => {
    save({ voice })
    const { demande, routes } = await boucles(BEAUNE, 5)
    const route = routes.find((r) => r.laps === 1)
    return { route, run: await courir(route, demande, { ecart: true }) }
  }
  const annonces = (run) => run.dites.map((d) => distanceDite(d.texte)).filter((m) => m != null)
  const ecartDit = (run) => run.dites.some((d) => d.texte.startsWith("Tu t'es écarté"))

  it('un kilomètre sur deux, l’allure et le temps couru, les virages annoncés plus tôt', async () => {
    const { route, run } = await ecouter({ km: 2, lap: false, pace: true, total: true, lead: 'early' })
    expect(defauts(route, run, { km: 2, avance: 1.5 }).join('\n'), transcription(run)).toBe('')
    expect(ecartDit(run), transcription(run)).toBe(true)
    const bornes = run.dites.filter((d) => /^\S+ kilomètre\./.test(d.texte)).map((d) => d.texte)
    expect(bornes.length, transcription(run)).toBeGreaterThan(0)
    for (const b of bornes) expect(b).toMatch(/^(Deuxième|Quatrième) kilomètre\. Allure moyenne [^.]+\. \d+ minutes de course\.$/)
    // À l'allure du coureur, une trentaine de secondes font cent mètres : la
    // moitié de plus, cent cinquante.
    expect(Math.max(...annonces(run)), transcription(run)).toBeGreaterThan(130)
  }, 60_000)

  it('les kilomètres tus, les virages annoncés plus tard, et l’écart dit quand même', async () => {
    const { route, run } = await ecouter({ km: 0, lead: 'late' })
    expect(defauts(route, run, { km: 0 }).join('\n'), transcription(run)).toBe('')
    expect(ecartDit(run), transcription(run)).toBe(true)
    expect(Math.max(...annonces(run)), transcription(run)).toBeLessThanOrEqual(70)
  }, 60_000)
})
