/**
 * Les consignes du moteur (`engine/navigation.js`, `restart.js`, `detour.js`) sont
 * écrites en français et gardées ainsi dans les parcours : on ne les réécrit pas,
 * on les traduit **à l'affichage et à la voix**. Elles viennent d'une grammaire
 * fermée — une dizaine de phrases et le nom de la rue —, que ce tableau couvre ;
 * les noms de rues restent tels quels, comme sur la carte.
 *
 * Une phrase que le tableau ne connaît pas reste en français : mieux vaut une
 * consigne dans l'autre langue que pas de consigne.
 */

import { lang } from './i18n'
import { on } from './engine/navigation'

const CARDINALS = [
  [/le nord-est/g, 'northeast'], [/le nord-ouest/g, 'northwest'], [/le sud-est/g, 'southeast'],
  [/le sud-ouest/g, 'southwest'], [/le nord/g, 'north'], [/le sud/g, 'south'], [/l'est/g, 'east'], [/l'ouest/g, 'west'],
]
const ORDINALS = { première: 'first', premier: 'first', deuxième: 'second', troisième: 'third', quatrième: 'fourth', cinquième: 'fifth', sixième: 'sixth' }
const SIDE = { 'légèrement à gauche': 'slightly left', 'légèrement à droite': 'slightly right', 'franchement à gauche': 'sharp left', 'franchement à droite': 'sharp right', 'à gauche': 'left', 'à droite': 'right', 'tout droit': 'straight' }

const RULES = [
  [/Tourne franchement à (gauche|droite)/g, (m, s) => `Turn sharp ${s === 'gauche' ? 'left' : 'right'}`],
  [/Tourne à (gauche|droite)/g, (m, s) => `Turn ${s === 'gauche' ? 'left' : 'right'}`],
  [/Serre à (gauche|droite)/g, (m, s) => `Bear ${s === 'gauche' ? 'left' : 'right'}`],
  [/Fais demi-tour/g, 'Make a U-turn'],
  [/Continue tout droit/g, 'Continue straight'],
  [/Te voilà rentré au départ\./g, "You're back at the start."],
  [/Tu es revenu au point de départ\. Boucle terminée\./g, "You're back at the start. Loop complete."],
  [/Dernier tour bouclé\. Les (\d+) tours sont terminés\./g, 'Last lap done. All $1 laps complete.'],
  [/Fin du (\S+) tour\./g, (m, o) => `End of the ${ORDINALS[o] ?? o.replace('ᵉ', 'th')} lap.`],
  [/Dernier tour\./g, 'Last lap.'],
  [/Encore (\d+) tours\./g, '$1 laps to go.'],
  [/Repars vers /g, 'Head '],
  [/Départ — en sortant, pars (à gauche|à droite|tout droit)/g, (m, s) => `Start — on leaving, head ${SIDE[s]}`],
  [/Départ — pars vers /g, 'Start — head '],
  [/Au rond-point, prends la (\S+) sortie/g, (m, o) => `At the roundabout, take the ${ORDINALS[o] ?? o.replace('e', 'th')} exit`],
  [/Au rond-point, /g, 'At the roundabout, '],
  [/continue en face/g, 'go straight on'],
  [/fais demi-tour/g, 'make a U-turn'],
  [/prends (légèrement|franchement) à (gauche|droite)/g, (m, a, s) => (a === 'légèrement' ? `bear ${s === 'gauche' ? 'left' : 'right'}` : `turn sharp ${s === 'gauche' ? 'left' : 'right'}`)],
  [/prends à (gauche|droite)/g, (m, s) => `turn ${s === 'gauche' ? 'left' : 'right'}`],
  [/prends tout droit/g, 'go straight'],
  [/ en restant à (gauche|droite)/g, (m, s) => ` staying on the ${s === 'gauche' ? 'left' : 'right'}`],
  [/ en faisant le tour par la (gauche|droite)/g, (m, s) => ` going around on the ${s === 'gauche' ? 'left' : 'right'}`],
  [/ puis tout de suite /g, ' then right away '],
  ...CARDINALS,
  [/légèrement à (gauche|droite)/g, (m, s) => `slightly ${s === 'gauche' ? 'left' : 'right'}`],
  [/franchement à (gauche|droite)/g, (m, s) => `sharp ${s === 'gauche' ? 'left' : 'right'}`],
  [/ à (gauche|droite)/g, (m, s) => (s === 'gauche' ? ' left' : ' right')],
  [/ demi-tour/g, ' U-turn'],
  [/ tout droit/g, ' straight'],
  // Le nom de la rue : « dans la rue X », « sur la route X », « sur X ».
  [/ (?:dans|sur) (?:la |le |l'|les )?/g, ' on '],
]

/** La phrase d'une consigne dans la langue du moment. */
export function stepText(text) {
  if (lang() !== 'en' || !text) return text
  let out = text
  for (const [from, to] of RULES) out = out.replace(from, to)
  return out
}

/** « sur rue Pasteur » : la rue, après un virage, dans la langue du moment. */
export const onRoad = (road) => (lang() === 'en' ? (road ? ` on ${road}` : '') : on(road))

const COMPASS_EN = { nord: 'North', 'nord-est': 'Northeast', est: 'East', 'sud-est': 'Southeast', sud: 'South', 'sud-ouest': 'Southwest', ouest: 'West', 'nord-ouest': 'Northwest' }

/** « Boucle nord · Rue La Fayette » → « North loop · Rue La Fayette » : le nom que le moteur donne à une proposition. */
export function routeName(name) {
  if (lang() !== 'en' || typeof name !== 'string') return name
  return name.replace(/^Boucle ([a-zé-]+)/i, (m, dir) => (COMPASS_EN[dir.toLowerCase()] ? `${COMPASS_EN[dir.toLowerCase()]} loop` : m))
}

/** « sud-ouest » → « southwest » : un point cardinal dit par le moteur, dans la langue du moment. */
export const compass = (dir) => (lang() === 'en' ? (COMPASS_EN[String(dir).toLowerCase()] ?? dir).toLowerCase() : dir)

const ENGINE = [
  [/^Presque intégralement sur trottoir ou voie propre\.$/, 'Almost entirely on sidewalk or clean way.'],
  [/^(\d+) % sur trottoir ou voie propre\.$/, '$1 % on sidewalk or clean way.'],
  [/^(\d+) m au contact du trafic, dont (\d+) m d'un seul tenant\.$/, '$1 m in contact with traffic, of which $2 m in one stretch.'],
  [/^Aucune portion au contact direct du trafic\.$/, 'No stretch in direct contact with traffic.'],
  [/^(\d+) traversée\(s\) sans passage protégé — l'app te préviendra 120 m avant\.$/, '$1 unprotected crossing(s) — the app will warn you 120 m before.'],
  [/^(\d+) traversée\(s\) protégée\(s\)\.$/, '$1 protected crossing(s).'],
  [/^Attention : sur (\d+) % du tracé, la présence d'un trottoir est estimée et non confirmée par OpenStreetMap\.$/, 'Careful: on $1 % of the route, the presence of a sidewalk is estimated and not confirmed by OpenStreetMap.'],
  [/^(\d+) % du parcours exposé au trafic \(maximum (\d+) %\)$/, '$1 % of the route exposed to traffic (maximum $2 %)'],
  [/^(\d+) m d'affilée sans trottoir \(maximum (\d+) m\)$/, '$1 m in a row without a sidewalk (maximum $2 m)'],
  [/^(\d+) traversées non protégées \(maximum (.+)\)$/, '$1 unprotected crossings (maximum $2)'],
  [/^(\d+) m de tunnel sans trottoir$/, '$1 m of tunnel without a sidewalk'],
  [/^la boucle ne se referme pas \((\d+) m d'écart\)$/, 'the loop does not close ($1 m gap)'],
  [/^(\d+) % du tracé parcouru deux fois$/, '$1 % of the route covered twice'],
]

/** Une note ou un motif de rejet du moteur de sécurité (`engine/safety.js`), dans la langue du moment. */
export function engineText(text) {
  if (lang() !== 'en' || typeof text !== 'string') return text
  for (const [from, to] of ENGINE) if (from.test(text)) return text.replace(from, to)
  return text
}
