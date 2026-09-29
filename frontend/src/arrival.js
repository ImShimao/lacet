// Savoir qu'on est arrivé.
//
// Jusqu'ici, une sortie se terminait d'un appui sur « Terminer ». Sur une
// boucle, c'est étrange : on revient exactement là d'où l'on est parti, le
// parcours le sait, et c'est quand même à nous de le dire — souvent trente
// secondes plus tard, le temps de sortir le téléphone. Ces secondes-là entrent
// dans le temps et l'allure de la sortie.
//
// **Le problème, c'est la précision du GPS, pas le seuil.** Un téléphone donne
// la position à cinq mètres près en terrain dégagé, à quinze entre deux
// immeubles. Terminer dès que la distance mesurée passe sous un seuil, c'est
// donc terminer n'importe où dans cette marge — parfois avant d'y être.
//
// On fait l'inverse : on **arme** l'arrivée en approchant, puis on suit la
// distance relevé après relevé, et l'on termine au **point le plus proche** —
// une fois qu'on s'en éloigne à nouveau, ou qu'on s'y est arrêté. Le minimum
// d'une courbe est bien mieux localisé que le bruit de chacun de ses points :
// l'instant de l'arrivée est alors juste à une seconde près, et sa position à
// la précision du GPS du moment, pas à celle du seuil.
//
// Trois gardes, parce qu'une boucle repasse parfois près de son départ :
// il faut avoir presque fini la distance prévue, être presque au bout du tracé,
// et être vraiment passé près — sinon, c'est le bouton qui décide, comme avant.

// Distance à l'arrivée à partir de laquelle on surveille.
const ARM_M = 70

// Le plus près qu'il faut être passé pour qu'on parle d'arrivée. Au-delà, on
// est passé dans la rue d'à côté, et terminer serait une erreur.
const NEAR_M = 14

// S'éloigner d'autant après le point le plus proche : c'est qu'on l'a dépassé.
// Six mètres, c'est deux relevés en courant — assez pour ne pas confondre avec
// le tremblement du GPS à l'arrêt.
const AWAY_M = 6

// À l'arrêt sur la ligne, la distance cesse de décroître sans jamais croître.
// Au bout de ce temps-là, le point le plus proche ne sera pas battu.
const HOLD_MS = 5000

// Il faut avoir fait la boucle. Trois conditions, et chacune répond à un cas
// précis :
//
// **Être au bout du tracé** écarte le passage près du départ à mi-parcours.
//
// **Être passé loin de l'arrivée au moins une fois** écarte le piège du
// démarrage : sur une boucle, le premier relevé peut se projeter à la fin du
// tracé — départ et arrivée sont le même point — et l'on « arriverait » avant
// d'avoir couru un mètre.
//
// **Avoir couru une part de la distance prévue** reste un garde-fou, mais à
// moitié seulement : la distance cumulée sous-compte dès que le GPS saute de
// plus de cent mètres — un tunnel, un immeuble, une reprise de signal — et une
// exigence trop haute empêchait alors l'arrivée de se déclencher du tout.
const DONE_SHARE = 0.5
const LEFT_M = 120

/**
 * Suit l'approche de l'arrivée.
 *
 * `push` rend `'arrived'` une seule fois, au relevé qui marque l'arrivée ; et
 * `null` le reste du temps. Les distances sont en mètres.
 */
export function arrivalWatcher({ armM = ARM_M, nearM = NEAR_M, awayM = AWAY_M, holdMs = HOLD_MS } = {}) {
  let armed = false
  let everFar = false
  let closest = Infinity
  let closestAt = 0
  let done = false

  return {
    get armed() {
      return armed
    },
    get closest() {
      return closest
    },
    /**
     * @param toFinish  distance à vol d'oiseau jusqu'au dernier point du tracé
     * @param remaining ce qu'il reste à parcourir sur le tracé
     * @param covered   ce qu'on a réellement parcouru
     * @param planned   la distance prévue pour la sortie
     */
    push({ toFinish, remaining, covered, planned, now = Date.now() }) {
      if (done || !Number.isFinite(toFinish)) return null
      // On s'éloigne avant de revenir : tant que ce n'est pas arrivé, il n'y a
      // pas d'arrivée possible.
      if (toFinish > armM) everFar = true
      const finishing =
        everFar && remaining <= LEFT_M && (!planned || covered >= planned * DONE_SHARE)
      if (!finishing) {
        // Reparti pour un tour, ou simple passage près du départ : on oublie
        // l'approche précédente plutôt que de garder un minimum d'il y a dix
        // minutes, qui déclencherait l'arrivée au prochain relevé proche.
        armed = false
        closest = Infinity
        return null
      }
      if (!armed && toFinish <= armM) {
        armed = true
        closest = toFinish
        closestAt = now
        return null
      }
      if (!armed) return null
      if (toFinish < closest) {
        closest = toFinish
        closestAt = now
        return null
      }
      if (closest > nearM) return null
      if (toFinish > closest + awayM || now - closestAt >= holdMs) {
        done = true
        return 'arrived'
      }
      return null
    },
  }
}
