import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import Icon from './Icon.jsx'
import { loadOptions, mapToken, styleByKey, traceColors } from './mapStyles'
import { rememberCamera } from './camera'
import { OFFLINE_PROTOCOL, loadOffline, offlineRequest } from './offlineMaps'
import { isNative } from './platform'
import { alongLine, bearingOf, cumulativeGain, drawPlan, drawnPart, easeBearing, profilePath, slopeAt } from './routeDraw'
import { km } from './format'
import { unitLabel } from './units'
import { useAppearance } from './appearance'

// Les cartes gardées hors ligne : `offlineRequest` détourne
// vers ce protocole ce qui est sur l'appareil. Voir `offlineMaps.js`.
maplibregl.addProtocol(OFFLINE_PROTOCOL, loadOffline)

// La carte en course, comme un GPS de voiture : inclinée, assez proche pour
// lire le prochain carrefour, et le coureur placé bas dans la partie visible
// pour montrer ce qui vient plutôt que ce qu'on vient de passer.
const NAV_ZOOM = 17
const NAV_PITCH = 50
const NAV_LOW = 0.22

// Le temps que met une boucle à se dessiner : celui du recadrage, à peu près,
// pour que la carte et le tracé arrivent ensemble.
const DRAW_MS = 750

// L'appui long qui pose un point de passage : celui d'iOS, à peu près.
const LONG_PRESS_MS = 500

// Le survol : assez bas pour lire les rues, assez incliné pour voir venir le
// relief, et le cap pris 250 m plus loin pour lisser les virages. Au zoom 15,6,
// une colline des Vosges remplissait l'écran et ne se lisait plus comme telle :
// 14,8 en montre le flanc entier, les rues toujours lisibles.
const FLY_ZOOM = 14.8
const FLY_PITCH = 62
const FLY_AHEAD_M = 250

// Deux repères d'arrêt du même genre plus proches que ça, le long du tracé,
// n'en font qu'un sur la carte.
const THIN_M = 120

// Les pictogrammes des repères d'arrêt, les mêmes que dans `Icon.jsx` : la carte
// les pose hors de React, en HTML.
const svg = (inner) =>
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const FLAG_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V3.5"/><path d="M6 4.5h12l-2.6 4 2.6 4H6"/></svg>'
// Le drapeau à damier de l'arrivée.
const FINISH_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5 4h14v9H5z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 4h3.5v3H5zM12 4h3.5v3H12zM8.5 7H12v3H8.5zM15.5 7H19v3h-3.5zM5 10h3.5v3H5zM12 10h3.5v3H12z" fill="currentColor"/></svg>'
// Quatre flèches : ce qu'on glisse, dans tous les sens.
const MOVE_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>'
const POI_SVG = svg('<path d="M12 3.5c3.2 4 5.5 7.1 5.5 10a5.5 5.5 0 0 1-11 0c0-2.9 2.3-6 5.5-10Z"/>')

export default function MapView({
  styleKey,
  start,
  route,
  ghost,
  stops = [],
  position,
  accuracy,
  cursor,
  focus,
  follow,
  navigate,
  heading,
  orientation = 'heading',
  overview,
  northAt,
  compassRef,
  placing,
  onPlace,
  onPickRoute,
  onUserMove,
  flyover = false,
  onFlyoverEnd,
  via = null,
  placingVia = false,
  onVia,
  zones = [],
  zoneDraft = null,
  onZoneCenter,
  destination = null,
  placingDest = false,
  onDestination,
  covered = false,
}) {
  const container = useRef(null)
  const map = useRef(null)

  // La disponibilité de la carte est un **état**, pas une ref : une ref ne
  // provoque aucun rendu, donc l'effet qui pose les tracés ne serait jamais
  // relancé quand la carte devient prête. C'est aussi ce qui permet de tout
  // reposer après un changement de fond, qui efface sources et couches.
  const [revision, setRevision] = useState(0)

  const handlers = useRef({})
  handlers.current = {
    onPlace, onPickRoute, onUserMove, onFlyoverEnd, onVia, placing, placingVia, compassRef, navigate,
    drawingZone: Boolean(zoneDraft), onZoneCenter, zones, zoneDraft, placingDest, onDestination,
  }

  // En course, la carte suit — jusqu'à ce qu'un doigt la déplace ou la tourne.
  // On la laisse alors où la main l'a mise, et « Recentrer » la reprend. Le
  // zoom, lui, ne libère rien : pincer pour voir plus loin et continuer d'être
  // suivi, c'est ce qu'on attend d'un GPS.
  const [locked, setLocked] = useState(true)
  const nav = useRef({})
  nav.current = { navigate, heading, locked, orientation, route }
  const relocked = useRef(true)
  // Le zoom voulu en course : celui du départ, puis celui qu'on a pincé. Tenu à
  // part plutôt que relu sur la carte : lu en pleine animation, il figeait la
  // carte au zoom intermédiaire dès qu'un relevé GPS interrompait la première.
  const navZoom = useRef(NAV_ZOOM)

  const theme = styleByKey(styleKey).contrast
  // L'accent et le thème : la carte se repeint quand ils changent.
  const look = useAppearance()

  // --- création ------------------------------------------------------------
  useEffect(() => {
    const initial = styleByKey(styleKey)
    const instance = new maplibregl.Map({
      container: container.current,
      center: [2.3522, 48.8566],
      zoom: 12,
      // Posée nous-mêmes, en bas à gauche : à droite, elle tombait au-dessus
      // des cartes de parcours, entre deux boutons, et donnait l'impression
      // d'un élément oublié là. À gauche, le coin est libre.
      attributionControl: false,
      // Les gestes tactiles à deux doigts sont la norme sur une carte plein
      // écran ; sans ça, faire défiler la page devient impossible sur mobile.
      cooperativeGestures: false,
      transformRequest: offlineRequest,
    })
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    map.current = instance
    // Le style est posé après coup plutôt que passé au constructeur : c'est la
    // seule voie par laquelle MapLibre accepte de le retoucher avant de
    // l'afficher (`transformStyle`), ce dont a besoin le fond « Nuit ».
    instance.setStyle(initial.style, loadOptions(initial))
    instance.on('moveend', () => {
      rememberCamera({ center: instance.getCenter().toArray(), zoom: instance.getZoom() })
    })

    // Idempotent : `load` et `styledata` peuvent se déclencher tous les deux, et
    // le test porte sur `getStyle()` — la feuille est-elle appliquée — surtout
    // pas sur `isStyleLoaded()`, qui reste faux tant qu'une tuile est en vol.
    const setup = () => {
      if (!instance.getStyle() || instance.getSource('route')) return
      addLayers(instance)
      setRevision((n) => n + 1)
    }
    instance.on('load', setup)
    instance.on('styledata', setup)
    setup()

    // `originalEvent` n'existe que pour un geste : les animations de suivi
    // déclenchent les mêmes événements, et ne doivent pas se libérer elles-mêmes.
    // Hors course, le même geste arrête le suivi de position.
    const release = (event) => {
      if (!event.originalEvent) return
      if (nav.current.navigate) setLocked(false)
      else handlers.current.onUserMove?.()
    }
    instance.on('dragstart', release)
    instance.on('rotatestart', release)
    instance.on('zoomend', (event) => {
      if (event.originalEvent && nav.current.navigate) navZoom.current = instance.getZoom()
    })

    // La boussole : son aiguille montre le nord. Mise à jour à même le bouton,
    // sans passer par React : la carte tourne à chaque image.
    const needle = () => {
      const button = handlers.current.compassRef?.current
      if (!button) return
      const north = -instance.getBearing()
      const angle = ((north % 360) + 360) % 360
      button.style.setProperty('--north', `${north}deg`)
      button.dataset.rotated = String(Math.min(angle, 360 - angle) > 1 || instance.getPitch() > 1)
    }
    instance.on('rotate', needle)
    instance.on('pitch', needle)
    instance.on('load', needle)

    // L'attribution compacte s'ouvre d'office : sur téléphone, elle barrait le
    // bas de la carte d'une bande de texte. Repliée, il en reste le « i » qui la
    // rouvre — et les sources sont citées en toutes lettres dans « Mon compte ».
    //
    // Elle se rouvre à chaque fois que MapLibre récrit son contenu — changement
    // de fond, chargement d'une source — d'où le repli à chaque `styledata`,
    // jusqu'à ce qu'on l'ouvre soi-même.
    let attributionAsked = false
    const collapseAttribution = () => {
      const attribution = instance.getContainer().querySelector('.maplibregl-ctrl-attrib')
      if (!attribution || attributionAsked) return
      attribution.classList.remove('maplibregl-compact-show')
      attribution.removeAttribute('open')
      attribution.querySelector('.maplibregl-ctrl-attrib-button')?.addEventListener(
        'click',
        () => {
          attributionAsked = true
        },
        { once: true },
      )
    }
    instance.on('load', collapseAttribution)
    instance.on('styledata', collapseAttribution)
    instance.on('idle', collapseAttribution)

    // **L'appui long** pose le point de passage : « passer par ici », le geste
    // des cartes routières. Un doigt immobile une demi-seconde, et rien
    // d'autre — un déplacement, un pincement ou un doigt levé l'annulent.
    let press = null
    const unpress = () => {
      clearTimeout(press?.timer)
      press = null
    }
    instance.on('touchstart', (event) => {
      unpress()
      if (event.originalEvent.touches?.length !== 1 || handlers.current.navigate || !handlers.current.onVia) return
      if (handlers.current.drawingZone) return
      // Un repère qu'on tient avant de le faire glisser n'est pas un appui long sur la carte.
      if (event.originalEvent.target?.closest?.('.maplibregl-marker')) return
      const at = event.point
      press = {
        at,
        timer: setTimeout(() => {
          const { lng, lat } = instance.unproject(at)
          press = null
          handlers.current.onVia?.({ lat, lon: lng })
        }, LONG_PRESS_MS),
      }
    })
    instance.on('touchmove', (event) => {
      if (press && (event.originalEvent.touches?.length !== 1 || event.point.dist(press.at) > 10)) unpress()
    })
    instance.on('touchend', unpress)
    instance.on('touchcancel', unpress)
    // À la souris, dans l'aperçu : le clic droit.
    instance.on('contextmenu', (event) => {
      if (!handlers.current.navigate) handlers.current.onVia?.({ lat: event.lngLat.lat, lon: event.lngLat.lng })
    })

    instance.on('click', (event) => {
      // Pendant le survol, toucher la carte le met en pause : rien d'autre.
      if (flying.current) return
      // Le centre de la zone à éviter : le toucher la pose, un autre la déplace.
      if (handlers.current.drawingZone) {
        handlers.current.onZoneCenter?.({ lat: event.lngLat.lat, lon: event.lngLat.lng })
        return
      }
      if (handlers.current.placingVia) {
        handlers.current.onVia?.({ lat: event.lngLat.lat, lon: event.lngLat.lng })
        return
      }
      if (handlers.current.placingDest) {
        handlers.current.onDestination?.({ lat: event.lngLat.lat, lon: event.lngLat.lng })
        return
      }
      if (handlers.current.placing) {
        handlers.current.onPlace?.({ lat: event.lngLat.lat, lon: event.lngLat.lng })
        return
      }
      // Toucher une proposition affichée en gris la met en avant : c'est le
      // geste naturel quand on compare trois tracés sur la carte.
      const hit = instance.queryRenderedFeatures(event.point, { layers: ['ghost-hit'] })
      const id = hit[0]?.properties?.id
      if (id) handlers.current.onPickRoute?.(id)
    })

    // MapLibre ne surveille que le redimensionnement de la *fenêtre*, jamais
    // celui de son conteneur. Deux conséquences, toutes deux constatées : si la
    // carte est créée avant que la mise en page lui ait donné une taille, elle
    // se croit vide et ne demande aucune tuile — écran noir définitif ; et sur
    // grand écran, le panneau latéral change de largeur sans que la carte s'en
    // aperçoive. Un observateur de taille règle les deux.
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)

    return () => {
      observer.disconnect()
      // Les repères et le dernier recadrage appartiennent à cette carte-ci. Une
      // carte recréée — à chaque rechargement à chaud en développement — doit
      // reposer les siens : gardés, ils lui faisaient croire les avoir déjà, et
      // elle restait sans repère de départ, au zoom d'ouverture.
      startMarker.current?.remove()
      startMarker.current = null
      viaMarker.current?.remove()
      viaMarker.current = null
      destMarker.current?.remove()
      destMarker.current = null
      zoneMarker.current?.remove()
      zoneMarker.current = null
      liveMarker.current?.remove()
      liveMarker.current = null
      lastFocus.current = 0
      if (map.current === instance) map.current = null
      instance.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- changement de fond de carte ------------------------------------------
  const currentStyle = useRef(styleKey)
  useEffect(() => {
    const m = map.current
    if (!m || currentStyle.current === styleKey) return
    currentStyle.current = styleKey
    // `setStyle` efface sources et couches ; `styledata` rappellera `setup`,
    // qui remettra tout en place et incrémentera la révision.
    const next = styleByKey(styleKey)
    m.setStyle(next.style, loadOptions(next))
  }, [styleKey])

  // --- couleurs du tracé selon le fond et l'apparence -------------------------
  useEffect(() => {
    const m = map.current
    if (!m || !revision || !m.getLayer('route-line')) return
    paintLayers(m, theme)
  }, [theme, revision, look])

  // --- recadrage explicite --------------------------------------------------
  // Volontairement piloté par un jeton (`focus.at`) plutôt que par la position
  // du départ : se géolocaliser ou choisir une adresse doit amener la carte sur
  // place, mais faire glisser le repère ne doit pas la faire sauter sous les
  // doigts. Deux gestes différents, deux comportements différents.
  const lastFocus = useRef(0)
  useEffect(() => {
    const m = map.current
    if (!m || !focus || focus.at === lastFocus.current) return
    lastFocus.current = focus.at
    m.flyTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(m.getZoom(), focus.zoom || 14),
      // Au centre de ce qu'on voit, pas de l'écran : le départ se posait sinon
      // derrière les cartes de parcours qui flottent en bas.
      offset: visibleCentre(m),
      duration: 900,
      essential: true,
    })
  }, [focus])

  // --- marqueur de départ, déplaçable ----------------------------------------
  const startMarker = useRef(null)
  useEffect(() => {
    const m = map.current
    if (!m || !start || !revision) return

    if (!startMarker.current) {
      const el = document.createElement('div')
      el.className = 'pin'
      el.innerHTML = '<span class="pin__dot"></span><span class="pin__stem"></span>'
      el.title = 'Fais-moi glisser pour déplacer le départ'
      startMarker.current = new maplibregl.Marker({
        element: el,
        draggable: true,
        anchor: 'bottom',
      })
      startMarker.current.on('dragend', () => {
        const { lat, lng } = startMarker.current.getLngLat()
        handlers.current.onPlace?.({ lat, lon: lng })
      })
      startMarker.current.setLngLat([start.lon, start.lat]).addTo(m)
    } else {
      startMarker.current.setLngLat([start.lon, start.lat])
    }
  }, [start, revision])

  // --- point de passage, déplaçable -------------------------------------------
  const viaMarker = useRef(null)
  useEffect(() => {
    const m = map.current
    if (!m || !revision) return
    if (!via) {
      viaMarker.current?.remove()
      viaMarker.current = null
      return
    }
    if (!viaMarker.current) {
      const el = document.createElement('div')
      el.className = 'viapin'
      el.setAttribute('role', 'img')
      el.setAttribute('aria-label', 'Point de passage — fais-le glisser pour le déplacer')
      el.innerHTML = FLAG_SVG
      viaMarker.current = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
      viaMarker.current.on('dragend', () => {
        const { lat, lng } = viaMarker.current.getLngLat()
        handlers.current.onVia?.({ lat, lon: lng })
      })
      viaMarker.current.setLngLat([via.lon, via.lat]).addTo(m)
    } else {
      viaMarker.current.setLngLat([via.lon, via.lat])
    }
  }, [via, revision])

  // --- arrivée d'un trajet de A à B, déplaçable --------------------------------
  // Un damier au bout d'une hampe : l'arrivée se distingue du départ (le rond)
  // et du point de passage (le fanion) sans légende.
  const destMarker = useRef(null)
  useEffect(() => {
    const m = map.current
    if (!m || !revision) return
    if (!destination) {
      destMarker.current?.remove()
      destMarker.current = null
      return
    }
    if (!destMarker.current) {
      const el = document.createElement('div')
      el.className = 'viapin destpin'
      el.setAttribute('role', 'img')
      el.setAttribute('aria-label', "Arrivée — fais-la glisser pour la déplacer")
      el.innerHTML = FINISH_SVG
      destMarker.current = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
      destMarker.current.on('dragend', () => {
        const { lat, lng } = destMarker.current.getLngLat()
        handlers.current.onDestination?.({ lat, lon: lng })
      })
      destMarker.current.setLngLat([destination.lon, destination.lat]).addTo(m)
    } else {
      destMarker.current.setLngLat([destination.lon, destination.lat])
    }
  }, [destination, revision])

  // --- zones à éviter -----------------------------------------------------------
  // Hachurées, celles qui comptent ; en pointillés, celles qu'on a mises de côté
  // — on les voit encore, pour comprendre pourquoi une boucle y entre à nouveau.
  // Celle qu'on est en train de poser se dessine pareil, à jour à chaque cran du
  // curseur.
  useEffect(() => {
    const m = map.current
    if (!m || !revision) return
    drawZones(m, navigate ? zones.filter((z) => z.on !== false) : zones, zoneDraft)
  }, [zones, zoneDraft, navigate, revision])

  // Le centre de la zone qu'on pose, à faire glisser. Une poignée plutôt que le
  // disque entier : un disque de 2 km couvre l'écran, et le saisir empêcherait
  // de déplacer la carte pour viser. Le cercle suit le doigt sans passer par
  // React — un rendu de toute l'app à chaque image saccadait le glissé — et
  // n'est confié à l'état qu'au lâcher.
  const zoneMarker = useRef(null)
  useEffect(() => {
    const m = map.current
    if (!m || !revision) return
    if (!zoneDraft || !Number.isFinite(zoneDraft.lon)) {
      zoneMarker.current?.remove()
      zoneMarker.current = null
      return
    }
    if (!zoneMarker.current) {
      const el = document.createElement('div')
      el.className = 'zonepin'
      el.setAttribute('role', 'img')
      el.setAttribute('aria-label', 'Centre de la zone — fais-le glisser pour la déplacer')
      el.innerHTML = MOVE_SVG
      const marker = new maplibregl.Marker({ element: el, draggable: true })
      marker.on('drag', () => {
        const { lng, lat } = marker.getLngLat()
        drawZones(m, handlers.current.zones, { ...handlers.current.zoneDraft, lon: lng, lat })
      })
      marker.on('dragend', () => {
        const { lng, lat } = marker.getLngLat()
        handlers.current.onZoneCenter?.({ lat, lon: lng })
      })
      zoneMarker.current = marker.setLngLat([zoneDraft.lon, zoneDraft.lat]).addTo(m)
    } else {
      zoneMarker.current.setLngLat([zoneDraft.lon, zoneDraft.lat])
    }
  }, [zoneDraft, revision])

  // --- position en direct + cercle de précision -------------------------------
  const liveMarker = useRef(null)
  // Où pointe le téléphone d'après sa boussole, ou `null`. Tenu hors de React :
  // il change vingt fois par seconde quand on tourne sur soi, et seul le repère
  // doit suivre — un rendu relancerait la caméra à chaque degré.
  const compass = useRef(null)
  const orient = useRef(() => {})
  orient.current = () => {
    const marker = liveMarker.current
    if (!marker) return
    // Avec la boussole, un faisceau montre où pointe le téléphone, en course
    // comme au repos : c'est lui qui dit, au carrefour, si l'on part du bon
    // côté. Sans elle, en course, une flèche suit le tracé. Couchés sur la
    // carte tous les deux, ils tournent avec elle.
    const beam = compass.current != null
    const arrow = !beam && Boolean(navigate) && heading != null
    const el = marker.getElement()
    el.classList.toggle('me--beam', beam)
    const dot = el.querySelector('.dot-live')
    dot.classList.toggle('dot-live--nav', Boolean(navigate))
    dot.classList.toggle('dot-live--arrow', arrow)
    const alignment = beam || arrow ? 'map' : 'viewport'
    marker.setRotationAlignment(alignment)
    marker.setPitchAlignment(alignment)
    marker.setRotation(beam ? compass.current : arrow ? heading : 0)
  }

  const located = Boolean(position)
  useEffect(() => {
    // La boussole ne tourne que tant que le point est affiché.
    if (!located || !isNative()) return undefined
    let stop = null
    let cancelled = false
    import('./native').then((n) => {
      if (cancelled) return
      stop = n.watchCompass((degrees) => {
        compass.current = degrees
        orient.current()
      })
    })
    return () => {
      cancelled = true
      stop?.()
      compass.current = null
    }
  }, [located])

  useEffect(() => {
    const m = map.current
    if (!m || !revision) return

    if (!position) {
      liveMarker.current?.remove()
      liveMarker.current = null
      m.getSource('accuracy')?.setData(empty())
      return
    }

    if (!liveMarker.current) {
      const el = document.createElement('div')
      el.className = 'me'
      el.innerHTML = '<div class="me__beam"></div><div class="dot-live"></div>'
      liveMarker.current = new maplibregl.Marker({ element: el })
      liveMarker.current.setLngLat(position).addTo(m)
    } else {
      liveMarker.current.setLngLat(position)
    }
    orient.current()

    // Le cercle de précision dit la vérité sur la fiabilité du point : à 300 m
    // près, afficher un point net serait un mensonge.
    m.getSource('accuracy')?.setData(
      accuracy > 12 ? circlePolygon(position, accuracy) : empty(),
    )

    if (navigate) {
      if (locked) {
        m.easeTo(navCamera(m, position, heading, navZoom.current, relocked.current, orientation === 'north'))
        relocked.current = false
      }
    } else if (follow) {
      m.easeTo({ center: position, offset: visibleCentre(m), duration: 700 })
    }
  }, [position, accuracy, follow, navigate, heading, orientation, locked, revision])

  // Changer d'orientation en course se voit tout de suite, avec une vraie
  // animation plutôt que le glissé linéaire du suivi.
  const lastOrientation = useRef(orientation)
  if (lastOrientation.current !== orientation) {
    lastOrientation.current = orientation
    relocked.current = true
  }

  // --- vue d'ensemble, nord en haut ---------------------------------------------
  // Tout le parcours d'un coup d'œil, en pleine course : la carte cesse de
  // suivre, et « Recentrer » la reprend.
  const lastOverview = useRef(overview)
  useEffect(() => {
    const m = map.current
    if (!m || overview === lastOverview.current) return
    lastOverview.current = overview
    const line = nav.current.route?.geometry
    if (!line?.length) return
    setLocked(false)
    const bounds = line.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(line[0], line[0]))
    m.fitBounds(bounds, { padding: dockPadding(m), bearing: 0, pitch: 0, duration: 800 })
  }, [overview])

  // --- le sens, en mouvement ---------------------------------------------------
  // De petits traits blancs coulent dans le tracé, dans son sens, comme chez
  // RunnrZ : le sens se voit sans chercher, et la boucle paraît vivante.
  // MapLibre ne sait pas décaler des pointillés : on fait tourner le motif en
  // réécrivant `line-dasharray` (voir `flowDashes`).
  //
  // Chaque cran redessine toute la carte : c'est le prix de l'effet. D'où quatre
  // économies. Vingt crans par seconde, pas soixante : à vingt-cinq pixels par
  // seconde, l'œil ne voit pas la différence. Rien sous une page qui cache la
  // carte. Rien de loin (`FLOW_MIN_ZOOM`), où les traits ne font qu'un
  // scintillement. Et **une pause au repos** : quand personne n'a touché la
  // carte depuis `FLOW_IDLE_MS`, les traits s'arrêtent ; le moindre geste sur la
  // carte, ou une autre boucle, relance. Partout où rien ne bouge, les chevrons
  // fixes disent le sens — en course aussi, pendant le survol, et quand iOS
  // demande moins de mouvement.
  const hasRoute = route?.geometry?.length > 1
  const routeId = route?.id
  useEffect(() => {
    const m = map.current
    if (!m || navigate || flyover || covered || !hasRoute) return undefined
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    let frame = 0
    let last = -1
    let awake = performance.now()
    const show = (moving) => {
      if (!m.style || !m.getLayer('route-flow')) return
      m.setLayoutProperty('route-flow', 'visibility', moving ? 'visible' : 'none')
      m.setLayoutProperty('route-arrows', 'visibility', moving ? 'none' : 'visible')
    }
    const tick = (now) => {
      // Au repos : on rend la main, plus aucune image n'est demandée.
      if (now - awake > FLOW_IDLE_MS) {
        frame = 0
        show(false)
        return
      }
      frame = requestAnimationFrame(tick)
      // Une carte détruite n'a plus de style : `getLayer` y lèverait une erreur.
      if (!m.style || !m.getLayer('route-flow')) return
      // De loin, les traits ne font plus qu'un scintillement : les chevrons
      // fixes disent mieux le sens, et la carte n'a plus à se redessiner.
      // L'état se relit sur la carte : un changement de thème repose les
      // couches, traits cachés.
      const near = m.getZoom() >= FLOW_MIN_ZOOM
      if (near !== (m.getLayoutProperty('route-flow', 'visibility') === 'visible')) {
        show(near)
        last = -1
      }
      if (!near) return
      const step = Math.floor(now / FLOW_STEP_MS) % FLOW_STEPS
      if (step === last) return
      last = step
      m.setPaintProperty('route-flow', 'line-dasharray', flowDashes(step))
    }
    const wake = () => {
      awake = performance.now()
      if (!frame) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    // Un doigt sur la carte — glisser, pincer, toucher — la réveille.
    m.on('movestart', wake)
    m.on('touchstart', wake)
    m.on('mousedown', wake)
    return () => {
      cancelAnimationFrame(frame)
      m.off('movestart', wake)
      m.off('touchstart', wake)
      m.off('mousedown', wake)
      show(false)
    }
  }, [hasRoute, routeId, navigate, flyover, covered, styleKey])

  // --- survol 3D ------------------------------------------------------------------
  // La boucle vue d'en haut, carte inclinée sur le relief, de la porte à la
  // porte : une pastille y court, la caméra la suit, et la part déjà parcourue
  // s'allume derrière elle — on y reconnaît les rues et les côtes avant d'y
  // courir. Toucher la carte met en pause et reprend ; la faire glisser arrête
  // le survol, et la carte revient à plat sur toute la boucle.
  const hud = useRef(null)
  // Les commandes du tableau (lecture, vitesse, vue, barre de temps) : posées
  // par l'effet du survol, appelées par `FlyHud` sans passer par l'état React.
  const flyCtl = useRef(null)
  const flying = useRef(false)
  useEffect(() => {
    const m = map.current
    const route = nav.current.route
    const line = route?.geometry
    // Une carte recréée dont le style n'est pas encore posé n'a pas de tracé à
    // survoler : y ajouter le relief plantait toute l'app. Le bouton repasse
    // alors sur « 3D », au lieu de rester sur un survol qui ne vient pas.
    if (!m || !flyover || !(line?.length > 1)) return undefined
    if (!m.getLayer('route-line')) {
      handlers.current.onFlyoverEnd?.()
      return undefined
    }
    flying.current = true
    const { total, at } = alongLine(line)
    const plan = drawPlan({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } })
    const ms = flyDuration(total)
    // Mouvement réduit : la caméra ne bouge pas, la boucle se voit d'un bloc,
    // inclinée, et seule la pastille avance.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const bounds = line.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(line[0], line[0]))
    // Trois vues, comme chez Roovr : « Coureur » au ras des rues, « Drone » plus
    // haut pour voir venir les carrefours, « Orbite » qui tourne autour de toute
    // la boucle pendant que la pastille avance.
    // Le tableau du survol couvre le bas de l'écran : la caméra vise le milieu
    // de ce qui reste au-dessus. Sans cela, en « Orbite », la boucle entière
    // était cadrée sur tout l'écran, et la pastille passait derrière le texte.
    const before = m.getPadding()
    const pad = () => ({ top: 80, bottom: (hud.current?.offsetHeight ?? 0) + 40, left: 30, right: 30 })
    // L'orbite tourne : la boucle doit tenir dans le cadre sous tous les angles,
    // d'où un cran de recul sur le zoom qui la fait tenir à plat.
    const orbitZoom = () => {
      const fit = m.cameraForBounds(bounds, { padding: pad() })?.zoom ?? 13
      return Math.max(10, fit - 0.6)
    }
    const VIEWS = {
      runner: { zoom: FLY_ZOOM, pitch: FLY_PITCH },
      drone: { zoom: FLY_ZOOM - 1.6, pitch: 48 },
      orbit: { zoom: 13, pitch: 55 },
    }
    let view = 'runner'
    let orbit = 0
    const camera = (center, bearing) =>
      view === 'orbit'
        ? { center: bounds.getCenter(), bearing: orbit, ...VIEWS.orbit, padding: pad() }
        : { center, bearing, ...VIEWS[view], padding: pad() }
    const ahead = (d) => bearingOf(at(d), at(d + FLY_AHEAD_M))
    const unrelief = relief(m)
    const gainAt = cumulativeGain(route.elevation_profile, route.ascent_m)

    const el = document.createElement('div')
    el.className = 'flypin'
    el.innerHTML = '<span class="flypin__pulse"></span><span class="flypin__dot"></span>'
    const pin = new maplibregl.Marker({ element: el }).setLngLat(line[0]).addTo(m)
    // Le reste de la boucle s'efface un peu : ce qui est parcouru doit se détacher.
    m.setPaintProperty('route-line', 'line-opacity', 0.55)
    m.setPaintProperty('route-edge', 'line-opacity', 0.3)
    m.setPaintProperty('route-arrows', 'icon-opacity', 0.4)

    const show = (d, paused) => {
      const box = hud.current
      if (!box) return
      box.querySelector('[data-km]').textContent = km(d, 1)
      const profile = route.elevation_profile
      const along = (d / total) * (profile?.at(-1)?.dist_m ?? total)
      const gain = gainAt(along)
      box.querySelector('[data-gain]').textContent = gain == null ? '—' : String(Math.round(gain))
      box.querySelector('[data-time]').textContent = clock(elapsed)
      const seek = box.querySelector('[data-seek]')
      if (seek && document.activeElement !== seek) seek.value = String(Math.round((d / total) * 1000))
      // La pente du moment, sur 100 m : c'est elle qui dit, en survolant, à
      // quel kilomètre ça monte et où ça redescend.
      const slope = slopeAt(profile, along)
      const flat = slope == null || Math.abs(slope) < 1
      box.querySelector('[data-slope]').textContent =
        slope == null ? '—' : flat ? 'Plat' : `${slope > 0 ? '↗' : '↘'} ${Math.round(Math.abs(slope))} %`
      box.dataset.trend = flat ? 'flat' : slope > 0 ? 'up' : 'down'
      box.style.setProperty('--p', String(d / total))
      box.dataset.paused = String(paused)
    }

    let raf = 0
    let bearing = ahead(0)
    let elapsed = 0
    let last = null
    let paused = false
    let speed = 1
    // Pendant le fondu d'une vue à l'autre, la caméra n'est plus poussée à chaque image.
    let blendUntil = 0
    const frame = (now) => {
      const dt = last == null ? 0 : now - last
      last = now
      if (!paused) elapsed = Math.min(ms, elapsed + dt * speed)
      const t = elapsed / ms
      const d = t * total
      // La pastille est au bout de la traînée : tirées du même calcul, elles
      // ne se décollent jamais l'une de l'autre.
      const flown = drawnPart(plan, t)
      const head = flown.features[0]?.geometry.coordinates.at(-1) ?? line[0]
      m.getSource('flown')?.setData(flown)
      pin.setLngLat(head)
      if (!still && !paused && now > blendUntil) {
        bearing = easeBearing(bearing, ahead(d), dt * speed)
        orbit = (orbit + dt * speed * 0.012) % 360
        m.jumpTo(camera(head, bearing))
      }
      // Arrivé au bout, le survol s'arrête sur la porte au lieu de se fermer :
      // « Recommencer » ou la barre de temps le relancent.
      if (t >= 1) paused = true
      show(d, paused)
      raf = requestAnimationFrame(frame)
    }
    if (still) {
      m.fitBounds(bounds, { padding: dockPadding(m), bearing: 0, pitch: 50, duration: 0 })
    } else {
      m.easeTo({ ...camera(line[0], bearing), duration: 1200 })
    }
    show(0, false)
    const begin = setTimeout(() => (raf = requestAnimationFrame(frame)), still ? 0 : 1200)

    const toggle = () => {
      // Au bout, « lecture » repart du début.
      if (paused && elapsed >= ms) elapsed = 0
      paused = !paused
    }
    flyCtl.current = {
      toggle,
      restart: () => {
        elapsed = 0
        paused = false
      },
      setSpeed: (value) => {
        speed = value
      },
      seek: (t) => {
        elapsed = Math.max(0, Math.min(1, t)) * ms
      },
      setView: (next) => {
        view = next
        if (next === 'orbit') VIEWS.orbit.zoom = orbitZoom()
        if (still) return
        const d = (elapsed / ms) * total
        bearing = ahead(d)
        m.easeTo({ ...camera(at(d), bearing), duration: 700 })
        blendUntil = performance.now() + 700
      },
    }
    const stop = (event) => {
      if (event.originalEvent) handlers.current.onFlyoverEnd?.()
    }
    const events = ['dragstart', 'wheel', 'rotatestart', 'pitchstart']
    for (const name of events) m.on(name, stop)
    m.on('click', toggle)
    return () => {
      flying.current = false
      flyCtl.current = null
      clearTimeout(begin)
      cancelAnimationFrame(raf)
      for (const name of events) m.off(name, stop)
      m.off('click', toggle)
      pin.remove()
      // La carte a pu être détruite avant ce nettoyage (démontage, rechargement
      // à chaud) : la toucher encore plantait l'app.
      if (map.current !== m) return
      m.getSource('flown')?.setData(empty())
      // Le cadrage au-dessus du tableau ne doit pas survivre au survol.
      m.setPadding(before)
      if (m.getLayer('route-line')) {
        m.setPaintProperty('route-line', 'line-opacity', 1)
        m.setPaintProperty('route-edge', 'line-opacity', 0.85)
        m.setPaintProperty('route-arrows', 'icon-opacity', 1)
      }
      // Pas de relief en course : il coûte des tuiles et du calcul à chaque image.
      unrelief()
      // Le départ d'une sortie reprend la caméra lui-même.
      if (nav.current.navigate) return
      m.fitBounds(bounds, { padding: dockPadding(m), bearing: 0, pitch: 0, duration: 900 })
    }
  }, [flyover])

  const lastNorth = useRef(northAt)
  useEffect(() => {
    const m = map.current
    if (!m || northAt === lastNorth.current) return
    lastNorth.current = northAt
    m.easeTo({ bearing: 0, pitch: 0, duration: 500 })
  }, [northAt])

  // Chaque départ reprend une carte suivie ; chaque arrivée la redresse, pour
  // revoir le parcours à plat, nord en haut, comme avant la sortie.
  const wasNavigating = useRef(false)
  useEffect(() => {
    const m = map.current
    if (navigate && !wasNavigating.current) {
      setLocked(true)
      relocked.current = true
      navZoom.current = NAV_ZOOM
    }
    if (!navigate && wasNavigating.current && m) {
      m.easeTo({ pitch: 0, bearing: 0, duration: 600 })
    }
    wasNavigating.current = Boolean(navigate)
  }, [navigate])

  // --- points d'eau -------------------------------------------------
  // Des repères HTML plutôt qu'une couche de symboles : deux des fonds (Relief,
  // Satellite) n'ont pas de jeu de glyphes, et un symbole n'y s'afficherait pas.
  // Ils sont peu nombreux — une poignée le long d'une boucle.
  const stopMarkers = useRef([])
  useEffect(() => {
    const m = map.current
    if (!m || !revision) return undefined
    for (const marker of stopMarkers.current) marker.remove()
    // En ville, une fontaine tous les deux cents mètres : un repère par
    // tronçon de cent vingt mètres suffit à les voir, sans couvrir le tracé.
    const shown = stops.filter(
      (stop, i) => !stops.slice(0, i).some((o) => o.kind === stop.kind && Math.abs(o.along - stop.along) < THIN_M),
    )
    stopMarkers.current = shown.map((stop) => {
      const el = document.createElement('div')
      el.className = 'poi'
      el.setAttribute('role', 'img')
      el.setAttribute('aria-label', `Point d'eau${stop.name ? ` — ${stop.name}` : ''}`)
      el.innerHTML = POI_SVG
      return new maplibregl.Marker({ element: el }).setLngLat([stop.lon, stop.lat]).addTo(m)
    })
    return () => {
      for (const marker of stopMarkers.current) marker.remove()
      stopMarkers.current = []
    }
  }, [stops, revision])

  // --- point survolé sur la bande de parcours ----------------------------------
  useEffect(() => {
    const m = map.current
    if (!m || !revision) return
    m.getSource('cursor')?.setData(
      cursor ? { type: 'Point', coordinates: cursor } : empty(),
    )
    // Hors de l'écran — la carte restée zoomée sur une consigne, ou déplacée à
    // la main —, le point parcouru sur la bande ne se voyait plus du tout : la
    // carte va le chercher. Pas pendant un recadrage en cours : c'est celui
    // d'une consigne touchée, qui l'amène déjà sous les yeux.
    if (cursor && !m.isMoving() && !m.getBounds().contains(cursor)) {
      m.easeTo({ center: cursor, offset: visibleCentre(m), duration: 300 })
    }
  }, [cursor, revision])

  // --- tracés -------------------------------------------------------------------
  const drawing = useRef(0)
  useEffect(() => {
    const m = map.current
    if (!m || !revision) return undefined

    m.getSource('ghost')?.setData(ghostToGeoJson(ghost, route))

    // Le parcours se dessine depuis le départ, dans son sens, puis ses
    // traversées s'y posent. Pas en course : un détour remplace le tracé sous
    // les pieds, et doit y être tout de suite.
    const data = routeToGeoJson(route)
    // La flèche du départ se pose tout de suite : c'est elle qu'on lit en
    // premier, avant même que la boucle ait fini de se dessiner.
    m.getSource('route-start')?.setData(nav.current.navigate ? empty() : startArrowGeoJson(route))
    const finish = () => {
      m.getSource('route')?.setData(data)
      m.getSource('crossings')?.setData(crossingsToGeoJson(route))
    }
    const still = nav.current.navigate || matchMedia('(prefers-reduced-motion: reduce)').matches
    const plan = still ? null : drawPlan(data)
    if (!plan?.total) {
      finish()
    } else {
      m.getSource('crossings')?.setData(empty())
      const t0 = performance.now()
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / DRAW_MS)
        if (t >= 1) return finish()
        // Rapide au départ, posé à l'arrivée : la boucle se referme sans à-coup.
        m.getSource('route')?.setData(drawnPart(plan, 1 - (1 - t) ** 3))
        drawing.current = requestAnimationFrame(frame)
      }
      drawing.current = requestAnimationFrame(frame)
    }

    // En course, la carte suit le coureur : un nouveau tracé — un détour — ne
    // doit pas la faire sauter sur une vue d'ensemble.
    if (route?.geometry?.length && !nav.current.navigate) {
      const bounds = route.geometry.reduce(
        (acc, c) => acc.extend(c),
        new maplibregl.LngLatBounds(route.geometry[0], route.geometry[0]),
      )
      m.fitBounds(bounds, { padding: dockPadding(m), duration: 700 })
    }
    return () => cancelAnimationFrame(drawing.current)
  }, [route, ghost, revision])

  return (
    <>
      <div ref={container} className="map" />
      {flyover && <FlyHud hud={hud} ctl={flyCtl} route={route} onClose={() => handlers.current.onFlyoverEnd?.()} />}
      {navigate && !locked && (
        <button
          className="recenter"
          onClick={() => {
            relocked.current = true
            setLocked(true)
          }}
        >
          <Icon name="navigation" size={17} />
          Recentrer
        </button>
      )}
    </>
  )
}

/**
 * Le cadrage de la carte en course.
 *
 * Le cap passe en haut de l'écran. Le coureur est décalé vers le bas de la
 * partie visible. Le zoom est celui du départ, ou celui qu'on a choisi du bout
 * des doigts depuis.
 *
 * `north` : la carte reste nord en haut, à plat, comme une carte papier — le
 * coureur au centre, puisqu'il peut aller dans n'importe quel sens.
 */
function navCamera(m, position, heading, zoom, relock, north = false) {
  const [ox, oy] = visibleCentre(m)
  const pad = dockPadding(m)
  const visible = m.getContainer().clientHeight - pad.top - pad.bottom
  const shift = north ? 0 : Math.max(0, visible) * NAV_LOW
  return {
    center: position,
    bearing: north ? 0 : heading == null ? m.getBearing() : heading,
    pitch: north ? 0 : NAV_PITCH,
    zoom,
    offset: [ox, oy + shift],
    duration: relock ? 800 : 950,
    // Linéaire en suivi : les positions arrivent chaque seconde, et une
    // animation qui ralentit à la fin de chacune fait avancer la carte par
    // à-coups. En reprenant le suivi, la courbe par défaut de MapLibre — à
    // condition de ne pas lui passer `easing: undefined`, qui écrase ce défaut :
    // la première image plantait, et MapLibre ne dessinait plus rien ensuite.
    ...(relock ? {} : { easing: (t) => t }),
  }
}

/**
 * Marges à réserver autour du tracé : tout ce qui flotte sur la carte et en
 * cache une partie — le panneau, la recherche, la pastille d'activité, la
 * colonne de boutons, le bandeau de consigne.
 *
 * Mesurées à l'écran au moment du cadrage plutôt que codées en dur : la
 * disposition change avec la taille de l'iPhone, avec la feuille repliée ou
 * dépliée. Chaque élément est rangé contre le bord de carte qu'il longe, et la
 * marge de ce bord s'étend jusqu'à lui.
 *
 * La pastille d'activité est comptée à part : posée en `fixed` sous la
 * recherche, elle n'agrandit pas le panneau dont elle fait partie. Oubliée, elle
 * cachait le haut de la boucle — souvent le départ lui-même.
 */
function dockPadding(m) {
  const map = m.getContainer().getBoundingClientRect()
  const pad = { top: 32, bottom: 32, left: 32, right: 32 }

  for (const selector of ['.side', '.stage__top', '.sportpill', '.viapill', '.stage__tools', '.runbar']) {
    const el = document.querySelector(selector)
    if (!el) continue
    const r = el.getBoundingClientRect()
    const w = Math.min(r.right, map.right) - Math.max(r.left, map.left)
    const h = Math.min(r.bottom, map.bottom) - Math.max(r.top, map.top)
    if (w <= 0 || h <= 0) continue

    // Une bande qui traverse la carte longe forcément le bord perpendiculaire ;
    // sinon, un élément plus large que haut se range en haut ou en bas.
    const across = w >= map.width * 0.8 ? true : h >= map.height * 0.8 ? false : w >= h
    const side = across
      ? r.top - map.top < map.bottom - r.bottom
        ? 'top'
        : 'bottom'
      : r.left - map.left < map.right - r.right
        ? 'left'
        : 'right'
    const reach = {
      top: r.bottom - map.top,
      bottom: map.bottom - r.top,
      left: r.right - map.left,
      right: map.right - r.left,
    }[side]
    pad[side] = Math.max(pad[side], Math.round(reach) + 16)
  }

  // Bornées : feuille dépliée, ce qui recouvre dépasse ce qui reste de carte,
  // et des marges plus grandes que la carte font échouer le cadrage.
  shrink(pad, 'top', 'bottom', map.height)
  shrink(pad, 'left', 'right', map.width)
  return pad
}

/** Réduit deux marges opposées, à proportion, pour laisser au moins 80 px de carte. */
function shrink(pad, a, b, size) {
  const room = Math.max(0, size - 80)
  const total = pad[a] + pad[b]
  if (total <= room) return
  pad[a] = Math.floor((pad[a] * room) / total)
  pad[b] = Math.floor((pad[b] * room) / total)
}

/** Décalage qui pose un point au centre de la partie visible de la carte. */
function visibleCentre(m) {
  const p = dockPadding(m)
  return [(p.left - p.right) / 2, (p.top - p.bottom) / 2]
}

// Les traits qui coulent dans le tracé, en largeurs de ligne : un trait de
// FLOW_DASH, un blanc de FLOW_GAP. Le motif avance d'un pixel et quart par cran, vingt crans par seconde.
const FLOW_DASH = 3.5
const FLOW_GAP = 14
const FLOW_STEPS = 28
const FLOW_STEP_MS = 50
// Le temps sans geste sur la carte après lequel les traits s'arrêtent.
const FLOW_IDLE_MS = 20_000
// En dessous de ce zoom, toute une ville tient à l'écran : chevrons fixes.
const FLOW_MIN_ZOOM = 12.5

/**
 * Le motif de pointillés décalé de `step` crans dans le sens du tracé.
 * `line-dasharray` commence toujours par un trait : pour le déplacer, on
 * l'écrit en commençant par un trait de longueur nulle, ou par le bout d'un
 * trait coupé au bord de la période.
 */
export function flowDashes(step) {
  const period = FLOW_DASH + FLOW_GAP
  const o = (step / FLOW_STEPS) * period
  if (o + FLOW_DASH <= period) return [0, o, FLOW_DASH, period - o - FLOW_DASH]
  return [o + FLOW_DASH - period, period - FLOW_DASH, period - o, 0]
}

/**
 * La flèche de sens : un chevron blanc, cerné de sombre.
 *
 * Elle pointe vers la droite, et une icône posée sur la ligne
 * (`symbol-placement: 'line'`) suit la géométrie **dans le sens où elle a été
 * écrite** — celui du parcours. Pas de calcul, donc, pour trouver le sens.
 *
 * Elle remplace un chevron en motif de ligne (`line-pattern`) : étiré sur
 * chaque tronçon, il se coupait aux virages et aux jointures, se tordait dans
 * les rues en zigzag, et ne ressemblait plus à une flèche — on ne savait plus
 * dans quel sens tourner (retour d'essai sur l'iPhone, autour d'Illzach).
 *
 * Blanc cerné de sombre : le tracé change de teinte selon la sécurité, le fond
 * selon le style, le satellite peut être de n'importe quelle couleur. La
 * flèche porte son propre contraste et se lit partout.
 */
function arrowIcon() {
  // Un chevron ouvert, au trait arrondi, qui tient dans la largeur du tracé :
  // la pointe pleine d'avant débordait de la ligne et la hachait de blanc.
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const chevron = () => {
    ctx.beginPath()
    ctx.moveTo(12, 9.5)
    ctx.lineTo(19.5, 16)
    ctx.lineTo(12, 22.5)
  }
  chevron()
  ctx.strokeStyle = mapToken('--map-arrow-casing')
  ctx.lineWidth = 7
  ctx.stroke()
  chevron()
  ctx.strokeStyle = mapToken('--map-ink')
  ctx.lineWidth = 3.4
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

/** Les hachures d'une zone à éviter : des diagonales rouges, sur fond à peine teinté. */
function hatchPattern() {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const red = mapToken('--map-zone')
  ctx.fillStyle = red
  ctx.globalAlpha = 0.1
  ctx.fillRect(0, 0, size, size)
  ctx.globalAlpha = 0.75
  ctx.strokeStyle = red
  ctx.lineWidth = 2.5
  ctx.beginPath()
  // Trois traits pour que la diagonale se raccorde d'une tuile à l'autre.
  for (const offset of [-size, 0, size]) {
    ctx.moveTo(offset, size)
    ctx.lineTo(offset + size, 0)
  }
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

const colorExpression = (c) => [
  'match',
  ['get', 'level'],
  'safe', c.safe,
  'caution', c.caution,
  'risk', c.risk,
  'unknown', c.unknown,
  c.safe,
]

/**
 * Les couleurs de tout ce que l'app dessine sur la carte, prises dans les
 * jetons de l'interface (`styles/01-base.css`). Reposées à chaque changement
 * de fond, de thème ou d'accent : MapLibre garde sinon celles du moment où la
 * couche a été créée. Le tracé suit le fond (`contrast`) ; ce qui porte la
 * couleur de l'app — la pastille du survol, sa traînée — suit l'accent.
 */
function paintLayers(m, contrast) {
  const c = traceColors(contrast)
  const accent = c.unknown
  const set = (layer, key, value) => m.getLayer(layer) && m.setPaintProperty(layer, key, value)
  set('accuracy-fill', 'fill-color', mapToken('--map-accuracy'))
  set('ghost-line', 'line-color', c.ghost)
  set('route-halo', 'line-color', c.halo)
  set('route-edge', 'line-color', c.edge)
  set('route-line', 'line-color', colorExpression(c))
  set('flown-glow', 'line-color', accent)
  set('flown-line', 'line-color', mapToken('--map-flown'))
  set('crossing-dots', 'circle-color', mapToken('--map-ink'))
  set('crossing-dots', 'circle-stroke-color', ['case', ['get', 'protected'], c.caution, c.risk])
  set('cursor-dot', 'circle-color', accent)
  set('cursor-dot', 'circle-stroke-color', mapToken('--map-ink'))
  set('zones-line', 'line-color', mapToken('--map-zone'))
  set('zones-off', 'line-color', c.ghost)
  set('zones-pts', 'circle-stroke-color', mapToken('--map-zone'))
}

// Les couleurs des couches sont posées par `paintLayers`, juste après.
function addLayers(m) {
  m.addSource('accuracy', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'accuracy-fill',
    type: 'fill',
    source: 'accuracy',
    paint: { 'fill-opacity': 0.12 },
  })

  m.addSource('ghost', { type: 'geojson', data: empty() })
  // Les autres propositions : en pointillés, pour qu'elles se lisent comme des
  // alternatives et non comme des rues du fond de carte.
  m.addLayer({
    id: 'ghost-line',
    type: 'line',
    source: 'ghost',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-width': 3,
      'line-opacity': 0.8,
      'line-dasharray': [2, 1.6],
    },
  })
  // Zone de toucher élargie et invisible : viser un trait de 3 px au doigt est
  // impossible.
  m.addLayer({
    id: 'ghost-hit',
    type: 'line',
    source: 'ghost',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0.001 },
  })

  m.addSource('route', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'route-halo',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 9, 'line-opacity': 0.85 },
  })
  // Un liseré clair entre le halo sombre et la couleur, comme chez RunnrZ : la
  // boucle se détache de toutes les rues du fond, claires ou sombres.
  m.addLayer({
    id: 'route-edge',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 7, 'line-opacity': 0.85 },
  })
  m.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 5 },
  })

  // Les traits qui coulent dans le tracé (voir « le sens, en mouvement ») :
  // cachés tant que l'animation ne les a pas pris en main.
  m.addLayer({
    id: 'route-flow',
    type: 'line',
    source: 'route',
    // Des bouts arrondis : de petites gélules qui glissent, plutôt que des
    // tirets coupés net qui papillotent en avançant.
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 15, 2, 17, 2.6],
      'line-dasharray': flowDashes(0),
    },
  })

  // Le sens de parcours. Il n'est pas décoratif : les consignes de navigation,
  // le profil altimétrique et l'orientation par rapport au vent décrivent tous
  // la boucle **dans un sens précis**. La parcourir à l'envers donne les côtes
  // au mauvais moment, le vent de face à la fin, et un guidage qui annonce des
  // virages à gauche là où il faut tourner à droite.
  //
  // Une couche de symboles sans texte : les fonds Relief et Satellite, écrits
  // à la main, n'ont pas de champ `glyphs`, mais seul `text-field` en a besoin.
  // Les flèches qui se chevaucheraient s'effacent : aux jointures de deux
  // tronçons, chacun en posait une, collées l'une à l'autre.
  if (!m.hasImage('route-arrow')) {
    m.addImage('route-arrow', arrowIcon(), { pixelRatio: 2 })
  }
  m.addLayer({
    id: 'route-arrows',
    type: 'symbol',
    source: 'route',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 90,
      'icon-image': 'route-arrow',
      // Discrets de loin, lisibles de près : à petite échelle, des chevrons
      // pleine taille faisaient un pointillé blanc sur toute la boucle.
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.75, 15, 1, 17, 1.15],
      'icon-rotation-alignment': 'map',
      'icon-keep-upright': false,
      'icon-padding': 6,
      'icon-allow-overlap': false,
    },
  })

  // La flèche du départ, comme chez RunnrZ : une pointe pleine, juste après la
  // porte, qui dit par où partir avant qu'on ait cherché les traits qui coulent.
  if (!m.hasImage('route-start-arrow')) {
    m.addImage('route-start-arrow', startArrowIcon(), { pixelRatio: 2 })
  }
  m.addSource('route-start', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'route-start-arrow',
    type: 'symbol',
    source: 'route-start',
    // De loin, quatre-vingts mètres ne font que quelques pixels : la flèche
    // recouvrirait le départ au lieu de montrer par où partir.
    minzoom: 13,
    layout: {
      'icon-image': 'route-start-arrow',
      'icon-rotate': ['-', ['get', 'bearing'], 90],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 16, 1.25],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  // La traînée du survol : la part de boucle déjà parcourue par la pastille,
  // blanche cernée de l'accent, au-dessus du tracé que le survol atténue.
  m.addSource('flown', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'flown-glow',
    type: 'line',
    source: 'flown',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 14, 'line-opacity': 0.55, 'line-blur': 4 },
  })
  m.addLayer({
    id: 'flown-line',
    type: 'line',
    source: 'flown',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 5 },
  })

  m.addSource('crossings', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'crossing-dots',
    type: 'circle',
    source: 'crossings',
    paint: {
      'circle-radius': 6,
      'circle-stroke-width': 3,
    },
  })

  m.addSource('cursor', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'cursor-dot',
    type: 'circle',
    source: 'cursor',
    paint: {
      'circle-radius': 7,
      'circle-stroke-width': 3,
    },
  })

  // Les zones à éviter, posées en dernier mais glissées sous les tracés : une
  // zone dit où les boucles ne vont pas, elle ne doit pas masquer celle qui en
  // sort. En dernier, parce que `addImage` relance `styledata`, donc `setup` :
  // ajoutée avant la source `route`, l'image faisait tout reposer une seconde
  // fois — « Source "accuracy" already exists ».
  if (!m.hasImage('zone-hatch')) m.addImage('zone-hatch', hatchPattern(), { pixelRatio: 2 })
  m.addSource('zones', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'zones-fill',
    type: 'fill',
    source: 'zones',
    filter: ['get', 'on'],
    paint: { 'fill-pattern': 'zone-hatch' },
  }, 'ghost-line')
  m.addLayer({
    id: 'zones-line',
    type: 'line',
    source: 'zones',
    filter: ['get', 'on'],
    paint: { 'line-width': ['case', ['has', 'draft'], 3, 2] },
  }, 'ghost-line')
  m.addLayer({
    id: 'zones-off',
    type: 'line',
    source: 'zones',
    filter: ['!', ['get', 'on']],
    paint: { 'line-width': 2, 'line-dasharray': [2, 2] },
  }, 'ghost-line')
  // Les coins d'un contour qu'on pose.
  m.addLayer({
    id: 'zones-pts',
    type: 'circle',
    source: 'zones',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 3 },
  }, 'ghost-line')
}

const empty = () => ({ type: 'FeatureCollection', features: [] })

/** Les zones gardées, et celle qu'on pose quand son centre est choisi. */
function drawZones(m, zones, draft) {
  const ring = (points) => ({ type: 'Polygon', coordinates: [[...points, points[0]]] })
  const features = zones.map((z) => ({
    type: 'Feature',
    properties: { on: z.on !== false },
    geometry: z.polygon ? ring(z.polygon) : circlePolygon([z.lon, z.lat], z.radius_m),
  }))
  if (draft?.shape === 'polygon') {
    // Le contour en cours : ses coins, le trait qui les relie, puis la surface
    // dès qu'il en a trois.
    const points = draft.points ?? []
    for (const p of points) features.push({ type: 'Feature', properties: { on: true, draft: true }, geometry: { type: 'Point', coordinates: p } })
    if (points.length === 2) {
      features.push({ type: 'Feature', properties: { on: true, draft: true }, geometry: { type: 'LineString', coordinates: points } })
    } else if (points.length >= 3) {
      features.push({ type: 'Feature', properties: { on: true, draft: true }, geometry: ring(points) })
    }
  } else if (draft && Number.isFinite(draft.lon)) {
    features.push({
      type: 'Feature',
      properties: { on: true, draft: true },
      geometry: circlePolygon([draft.lon, draft.lat], draft.radius_m),
    })
  }
  m.getSource('zones')?.setData({ type: 'FeatureCollection', features })
}

// Le relief du survol : les Terrain Tiles d'AWS (Mapzen), libres et sans clé.
// Au-delà du zoom 12, elles n'apportent rien en France (mesuré le 19 octobre
// 2026 : les zooms 13 et 14 ne font qu'agrandir les mêmes données).
const DEM = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 12,
  attribution: 'Relief : Mapzen / Copernicus EU-DEM',
}

/**
 * Pose le relief sous la carte et rend de quoi le retirer. Hors ligne, ou dès
 * qu'une tuile d'altitude échoue, la carte reste — ou retombe — à plat :
 * un relief troué de tuiles manquantes serait pire que pas de relief.
 *
 * Deux sources plutôt qu'une : MapLibre recommande de ne pas partager celle du
 * relief avec l'ombrage, qui se disputeraient son cache de tuiles.
 */
function relief(m) {
  if (!navigator.onLine) return () => {}
  const drop = () => {
    m.off('error', failed)
    if (m.getTerrain?.()) m.setTerrain(null)
    if (m.getLayer('flyover-shade')) m.removeLayer('flyover-shade')
    for (const id of ['flyover-dem', 'flyover-shade-dem']) if (m.getSource(id)) m.removeSource(id)
  }
  const failed = (event) => {
    if (event.sourceId === 'flyover-dem' || event.sourceId === 'flyover-shade-dem') drop()
  }
  try {
    m.addSource('flyover-dem', DEM)
    m.addSource('flyover-shade-dem', DEM)
    // Sous tout ce que l'app dessine. Plus marqué que l'ombrage d'une carte
    // claire : sur le fond sombre, à 0,35, les collines de Guebwiller ne se
    // voyaient pas. Couleurs : les jetons `--map-relief-…`.
    m.addLayer(
      {
        id: 'flyover-shade',
        type: 'hillshade',
        source: 'flyover-shade-dem',
        paint: {
          'hillshade-exaggeration': 0.6,
          'hillshade-shadow-color': mapToken('--map-relief-shadow'),
          'hillshade-highlight-color': mapToken('--map-relief-light'),
          'hillshade-accent-color': mapToken('--map-relief-accent'),
        },
      },
      'accuracy-fill',
    )
    // Un peu exagéré : vue de haut et de biais, une côte de 50 m se lit à
    // peine à l'échelle réelle.
    m.setTerrain({ source: 'flyover-dem', exaggeration: 1.5 })
    m.on('error', failed)
  } catch {
    drop()
  }
  return drop
}

/** Cercle géographique approché — MapLibre ne sait pas dessiner un rayon en mètres. */
function circlePolygon([lon, lat], radiusM, steps = 48) {
  const dLat = (radiusM / 111_320) * (180 / 180)
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  const ring = []
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI
    ring.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

/**
 * Où poser la flèche du départ, et vers où la tourner : à quatre-vingts mètres
 * de la porte — plus près, le point de la position la recouvrait —, le cap pris
 * sur cinquante mètres pour qu'un premier coude de trottoir ne la fasse pas
 * pointer de travers.
 */
export function startArrowGeoJson(route) {
  const line = route?.geometry
  if (!(line?.length > 1)) return empty()
  const { total, at } = alongLine(line)
  if (total < 150) return empty()
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { bearing: bearingOf(at(55), at(105)) },
        geometry: { type: 'Point', coordinates: at(80) },
      },
    ],
  }
}

/** La pointe du départ : pleine, blanche cernée de sombre, tournée vers la droite. */
function startArrowIcon() {
  const size = 44
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(34, 22)
  ctx.lineTo(12, 11)
  ctx.lineTo(16.5, 22)
  ctx.lineTo(12, 33)
  ctx.closePath()
  ctx.strokeStyle = mapToken('--map-arrow-casing')
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.fillStyle = mapToken('--map-ink')
  ctx.fill()
  return ctx.getImageData(0, 0, size, size)
}

function routeToGeoJson(route) {
  // Un parcours rechargé depuis les favoris garde la liste de ses tronçons —
  // leur longueur, leur niveau, leur nom — mais **pas leurs coordonnées** :
  // elles pèsent à elles seules des centaines de kilooctets et satureraient le
  // stockage du navigateur. Tester la seule présence de `segments` ne suffit
  // donc pas ; sans coordonnées, on produisait un GeoJSON aux géométries vides
  // et le parcours ne s'affichait pas du tout.
  if (!route?.segments?.length || !route.segments[0]?.coords?.length) {
    // On le trace alors d'un seul tenant, en neutre, plutôt que rien.
    if (route?.geometry?.length) {
      return {
        type: 'Feature',
        properties: { level: 'safe' },
        geometry: { type: 'LineString', coordinates: route.geometry },
      }
    }
    return empty()
  }
  return {
    type: 'FeatureCollection',
    features: route.segments.map((segment) => ({
      type: 'Feature',
      properties: { level: segment.level, road: segment.road || '' },
      geometry: { type: 'LineString', coordinates: segment.coords },
    })),
  }
}

function crossingsToGeoJson(route) {
  if (!route?.crossings?.length) return empty()
  return {
    type: 'FeatureCollection',
    features: route.crossings.map((crossing) => ({
      type: 'Feature',
      properties: { protected: crossing.protected },
      geometry: { type: 'Point', coordinates: [crossing.lon, crossing.lat] },
    })),
  }
}

/** Les autres propositions, en gris derrière celle qui est sélectionnée. */
function ghostToGeoJson(routes, active) {
  if (!routes?.length) return empty()
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((r) => r.id !== active?.id)
      .map((r) => ({
        type: 'Feature',
        properties: { id: r.id },
        geometry: { type: 'LineString', coordinates: r.geometry },
      })),
  }
}

/**
 * Le tableau du survol 3D, en bas comme chez Roovr : la distance, l'altitude
 * et la pente au point atteint, puis la courbe d'altitude de toute la boucle,
 * remplie jusqu'où l'on en est. Mis à jour à chaque image par l'effet du
 * survol (`--p`, `data-*`), sans rendu React : soixante rendus par seconde
 * pour trois nombres seraient du gâchis.
 */
function FlyHud({ hud, ctl, route, onClose }) {
  const profile = route?.elevation_profile
  const chart = profilePath(profile)
  const [view, setView] = useState('runner')
  const [speed, setSpeed] = useState(1)
  const call = (name, ...args) => ctl.current?.[name]?.(...args)
  return (
    <div className="flyhud" ref={hud} data-paused="false" data-trend="flat">
      <div className="flyhud__head">
        <span className="flyhud__title">
          <em>Aperçu 3D</em>
          <b>{route?.name ?? 'Boucle'}</b>
        </span>
        <button className="flyhud__close" onClick={onClose} aria-label="Fermer l'aperçu 3D">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="flyhud__views" role="group" aria-label="Vue">
        {FLY_VIEWS.map((v) => (
          <button
            key={v.key}
            aria-pressed={view === v.key}
            onClick={() => {
              setView(v.key)
              call('setView', v.key)
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flyhud__stats">
        <span>
          <em>Distance</em>
          <b>
            <span data-km>0,0</span> <small>/ {km(route?.distance_m ?? 0, 1)} {unitLabel()}</small>
          </b>
        </span>
        <span>
          <em>D+</em>
          <b>
            <span data-gain>0</span> <small>/ {route?.ascent_m != null ? Math.round(route.ascent_m) : '—'} m</small>
          </b>
        </span>
        <span className="flyhud__slope">
          <em>Pente</em>
          <b data-slope>—</b>
        </span>
      </div>
      {chart && (
        <div className="flyhud__chart" aria-hidden="true">
          <svg viewBox="0 0 1000 60" preserveAspectRatio="none">
            <path d={chart.area} className="flyhud__area" />
            <path d={chart.line} className="flyhud__line" vectorEffect="non-scaling-stroke" />
          </svg>
          <svg viewBox="0 0 1000 60" preserveAspectRatio="none" className="flyhud__done">
            <path d={chart.area} className="flyhud__area flyhud__area--done" />
            <path d={chart.line} className="flyhud__line flyhud__line--done" vectorEffect="non-scaling-stroke" />
          </svg>
          <i className="flyhud__cursor" />
        </div>
      )}
      <input
        className="flyhud__seek"
        data-seek
        type="range"
        min="0"
        max="1000"
        defaultValue="0"
        aria-label="Avancer dans l'aperçu"
        onInput={(e) => call('seek', Number(e.currentTarget.value) / 1000)}
        onPointerUp={(e) => e.currentTarget.blur()}
      />
      <div className="flyhud__times">
        <span data-time>0:00</span>
        <span>{clock(flyDuration(route?.distance_m ?? 0))}</span>
      </div>
      <div className="flyhud__controls">
        <button className="flyhud__round" onClick={() => call('restart')} aria-label="Recommencer">
          <Icon name="refresh" size={18} />
        </button>
        <button className="btn btn--primary flyhud__play" onClick={() => call('toggle')}>
          <span className="flyhud__pause">
            <Icon name="pause" size={16} /> Pause
          </span>
          <span className="flyhud__resume">
            <Icon name="play" size={16} /> Lecture
          </span>
        </button>
        <button
          className="flyhud__round"
          aria-label={`Vitesse ${speed}×`}
          onClick={() => {
            const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
            setSpeed(next)
            call('setSpeed', next)
          }}
        >
          {String(speed).replace('.', ',')}×
        </button>
      </div>
    </div>
  )
}

const FLY_VIEWS = [
  { key: 'runner', label: 'Coureur' },
  { key: 'drone', label: 'Drone' },
  { key: 'orbit', label: 'Orbite' },
]
const SPEEDS = [1, 2, 0.5]

// Environ 600 m par seconde : une boucle de 10 km se survole en 17 s.
const flyDuration = (metres) => Math.min(30_000, Math.max(10_000, metres / 0.6))

/** « 1:05 » à partir de millisecondes. */
const clock = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

