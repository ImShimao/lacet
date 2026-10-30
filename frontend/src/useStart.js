import { useCallback, useEffect, useRef, useState } from 'react'
import { describePlace } from './api'
import { haversineM } from './engine/geo'
import { askedOf, placeOf } from './request'
import { recentPlaces } from './storage'

/** Le départ de la toute première ouverture, quand il n'y a rien d'autre. */
export const PARIS = { lat: 48.8566, lon: 2.3522 }

/**
 * Le point de départ, et la position qui le pose.
 *
 * Deux questions qu'on mêlait — « où suis-je » et « d'où je pars » — et qui ont
 * chacune leur bouton : `centerOnMe` amène la carte sur place, `startFromHere`
 * y pose le départ. `focus` est le jeton qui demande à la carte de s'y rendre.
 *
 * `onMoved` : le départ vient de bouger, et les boucles proposées ne répondent
 * plus à la question posée.
 */
export default function useStart(geo, { onMoved }) {
  const [start, setStart] = useState(null)
  // `applyStart` ne dépend de rien pour rester stable d'un rendu à l'autre ;
  // elle a pourtant besoin du départ courant, et le lit donc ici.
  const startRef = useRef(null)
  startRef.current = start
  const [startLabel, setStartLabel] = useState(null)
  const [placing, setPlacing] = useState(false)
  const [focus, setFocus] = useState(null)
  const moved = useRef(onMoved)
  moved.current = onMoved

  /** Remplace le départ sans rien demander d'autre — le repère qui rejoint la rue. */
  const setPoint = useCallback((next) => {
    startRef.current = next
    setStart(next)
  }, [])

  // `recenter` distingue les deux gestes : choisir un lieu amène la carte
  // dessus, déplacer le repère la laisse où elle est.
  const applyStart = useCallback(async (point, label, recenter = false) => {
    // Les boucles proposées partent toutes du point précédent : dès qu'il
    // bouge, elles ne répondent plus à la question posée. Elles restaient
    // pourtant à l'écran — on choisissait un village suisse et la carte montrait
    // le Valais sous une carte intitulée « Boucle sud-ouest · avenue des
    // Gobelins ». Dix mètres de tolérance pour le doigt qui replace le repère
    // sans vraiment le déplacer.
    const previous = startRef.current && askedOf(startRef.current)
    if (previous && haversineM([previous.lon, previous.lat], [point.lon, point.lat]) > 10) {
      moved.current?.()
    }
    startRef.current = point
    setStart(point)
    setStartLabel(label ?? null)
    setPlacing(false)
    if (recenter) setFocus({ ...point, at: Date.now() })
    if (label !== undefined) return
    // Un point sans nom — la position, un repère posé à la main : on demande
    // lequel, et la rue de l'adresse avec, pour sortir devant la bonne porte.
    // Seulement si le départ n'a pas bougé entre-temps : la réponse d'un point
    // quitté ne doit ni renommer ni déplacer le suivant.
    // (Une recherche lancée dans l'intervalle a pu poser le repère sur la rue :
    // le point choisi est alors gardé dans `asked`, et c'est lui qu'on nomme.)
    const place = await describePlace(point.lat, point.lon)
    const current = startRef.current
    if (current !== point && current?.asked !== point) return
    setStartLabel(place?.label ?? null)
    if (place?.street && !point.street) {
      const named = { ...point, street: place.street }
      const next = current === point ? named : { ...current, asked: named }
      startRef.current = next
      setStart(next)
    }
  }, [])

  // Au premier chargement on tente la position ; le refus n'est pas un échec,
  // c'est un cas normal — on retombe sur le dernier départ choisi, et la carte
  // reste utilisable.
  useEffect(() => {
    geo.locate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (geo.status === 'ready' && geo.position && !start) {
      applyStart({ lat: geo.position[1], lon: geo.position[0] }, undefined, true)
    }
    if ((geo.status === 'denied' || geo.status === 'error') && !start) {
      // Sans position, le dernier départ choisi vaut mieux que Paris : c'est
      // presque toujours chez soi, ses rues sont déjà sur l'appareil, et c'est
      // le seul repère dont on dispose. Paris ne reste que pour une première
      // ouverture, quand il n'y a encore rien à se rappeler.
      const dernier = recentPlaces()[0]
      if (dernier) applyStart(placeOf(dernier), dernier.label, true)
      else applyStart(PARIS, 'Paris', true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, geo.position])

  // Le bouton de position ne fait qu'une chose : amener la carte sur place.
  //
  // Comme sur les cartes d'un téléphone : une touche recentre, une seconde,
  // sans avoir bougé la carte entre-temps, la fait suivre nos déplacements ;
  // une troisième arrête. Si la position est déjà connue on y va tout de suite,
  // et on relance une mesure en parallèle pour l'affiner.
  const pendingLocate = useRef(false)
  const pendingStart = useRef(false)
  const centered = useRef(false)
  const centerOnMe = () => {
    if (geo.following) {
      geo.setFollowing(false)
      centered.current = false
      return
    }
    if (centered.current && geo.position) {
      geo.setFollowing(true)
      return
    }
    if (geo.position) {
      setFocus({ lat: geo.position[1], lon: geo.position[0], at: Date.now() })
      centered.current = true
    }
    pendingLocate.current = true
    geo.locate()
  }

  const startFromHere = () => {
    if (geo.position) {
      applyStart({ lat: geo.position[1], lon: geo.position[0] }, undefined, true)
    } else {
      pendingStart.current = true
      geo.locate()
    }
  }

  /** La carte a été déplacée à la main : elle ne suit plus, et n'est plus centrée. */
  const release = () => {
    centered.current = false
    if (geo.following) geo.setFollowing(false)
  }

  /**
   * Amène la carte sur un point sans toucher au départ — une consigne de la
   * feuille de route qu'on veut voir. Plus près que pour un départ : c'est le
   * carrefour qu'on regarde, pas le quartier.
   */
  const look = (point) => {
    release()
    setFocus({ ...point, zoom: 16, at: Date.now() })
  }

  // Résultat d'une demande explicite : on recadre — ou on pose le départ —
  // même si la position n'avait pas changé de valeur.
  useEffect(() => {
    if (geo.status !== 'ready' || !geo.position) return
    const point = { lat: geo.position[1], lon: geo.position[0] }
    if (pendingStart.current) {
      pendingStart.current = false
      applyStart(point, undefined, true)
    } else if (pendingLocate.current) {
      pendingLocate.current = false
      setFocus({ ...point, at: Date.now() })
      centered.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, geo.at])

  return {
    start,
    startLabel,
    placing,
    setPlacing,
    focus,
    applyStart,
    setPoint,
    centerOnMe,
    startFromHere,
    release,
    look,
  }
}
