/**
 * Prévenir un proche : le SMS du SOS, et ceux du départ et du retour.
 *
 * **L'app n'envoie rien elle-même.** Elle prépare le message et ouvre Messages ;
 * c'est la personne qui appuie sur « envoyer ». Un message parti tout seul
 * demanderait un serveur d'envoi, et serait fâcheux le jour d'un appui par
 * erreur. Le numéro reste sur l'appareil.
 *
 * Le départ et le retour viennent des apps de sécurité (Strava Beacon, Garmin
 * LiveTrack) : sans serveur, pas de suivi en direct, mais l'essentiel tient en
 * deux SMS — où je pars, quand je dois rentrer, puis que je suis rentré.
 */
import { km } from './format'
import { clockTime, minutes } from './runFormat'
import { load } from './storage'
import { unitLabel } from './units'

export const contactOf = () => load().emergencyContact || null

/** Le départ et le retour s'annoncent : réglé dans « Mon compte → Sécurité », et un numéro gardé. */
export const announcing = () => Boolean(load().notifyContact && contactOf())

/** Un lien vers le point, que n'importe quel téléphone ouvre sur une carte. */
export const mapLink = ([lon, lat]) => `https://www.google.com/maps?q=${lat.toFixed(5)},${lon.toFixed(5)}`

/**
 * Ouvre Messages vers `contact`, le texte prérempli ; à défaut — lien refusé,
 * pas de numéro —, la feuille de partage ; à défaut encore, le texte à copier.
 * Un message de sécurité qui échoue sans rien dire est le pire des cas.
 */
export async function textTo(contact, text, title) {
  if (contact) {
    // Le numéro réduit à ses chiffres (et au « + ») : « 06.12.34 » n'est pas un
    // numéro pour Messages. « ?&body= » : iOS lit l'un, Android l'autre.
    const href = `sms:${contact.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(text)}`
    try {
      const native = await import('./native')
      const { completed } = (await native.openExternal(href)) ?? {}
      if (completed !== false) return
    } catch {
      /* le partage, ci-dessous */
    }
  }
  await shareText(text, title)
}

export async function shareText(text, title) {
  try {
    const native = await import('./native')
    await native.shareText(title, text)
  } catch (error) {
    // Refermer la feuille de partage n'est pas une panne : iOS le signale comme
    // une erreur, et le message à copier surgissait alors pour rien.
    if (!/cancel/i.test(error?.message || '')) window.prompt('Copie ce message et envoie-le :', text)
  }
}

/**
 * « Je pars courir 10,2 km depuis ici : <lien>. Retour prévu vers 19:40. »
 * L'heure vient de l'estimation du parcours ; une sortie libre n'en a pas.
 */
export function departureText({ route = null, sport = 'run', from = null, now = Date.now() }) {
  const verb = sport === 'bike' ? 'rouler' : 'courir'
  const point = route?.geometry?.[0] ?? from
  const where = point ? ` depuis ici : ${mapLink(point)}` : ''
  if (!route) return `Je pars ${verb}${where}. Je te dis quand je suis de retour.`
  const back = route.duration_s ? ` Retour prévu vers ${clockTime(now + route.duration_s * 1000)}.` : ''
  return `Je pars ${verb} ${km(route.distance_m, 1)} ${unitLabel()}${where}.${back}`
}

/**
 * Annonce le départ, et ne rend la main qu'une fois revenu dans l'app : le
 * compte à rebours ne doit pas filer pendant qu'on écrit dans Messages. iOS
 * met un instant à passer d'une app à l'autre, d'où l'attente avant de
 * regarder si Lacet est encore devant.
 */
export async function announceDeparture(details, settleMs = 700) {
  await textTo(contactOf(), departureText(details), 'Lacet — je pars')
  await new Promise((resolve) => setTimeout(resolve, settleMs))
  if (document.visibilityState === 'visible') return
  await new Promise((resolve) => {
    const back = () => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', back)
      resolve()
    }
    document.addEventListener('visibilitychange', back)
  })
}

/** « De retour de ma sortie : 10,2 km en 58 min. » */
export function arrivalText(entry) {
  const done = entry.actual_distance_m > 0 ? ` : ${km(entry.actual_distance_m, 1)} ${unitLabel()} en ${minutes(Math.round((entry.actual_duration_s || 0) / 60))}` : ''
  return `De retour de ma sortie${done}. Tout va bien.`
}
