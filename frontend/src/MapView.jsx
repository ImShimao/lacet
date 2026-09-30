import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import Icon from './Icon.jsx'
import { TRACE_COLORS, loadOptions, styleByKey } from './mapStyles'
import { rememberCamera } from './camera'
import { OFFLINE_PROTOCOL, loadOffline, offlineRequest } from './offlineMaps'

// Les cartes gardées hors ligne : `offlineRequest` détourne
// vers ce protocole ce qui est sur l'appareil. Voir `offlineMaps.js`.
maplibregl.addProtocol(OFFLINE_PROTOCOL, loadOffline)

// La carte en course, comme un GPS de voiture : inclinée, assez proche pour
// lire le prochain carrefour, et le coureur placé bas dans la partie visible
// pour montrer ce qui vient plutôt que ce qu'on vient de passer.
const NAV_ZOOM = 17
const NAV_PITCH = 50
const NAV_LOW = 0.22

// Deux repères d'arrêt du même genre plus proches que ça, le long du tracé,
// n'en font qu'un sur la carte.
const THIN_M = 120

// Les pictogrammes des repères d'arrêt, les mêmes que dans `Icon.jsx` : la carte
// les pose hors de React, en HTML.
const svg = (inner) =>
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const POI_SVG = {
  water: svg('<path d="M12 3.5c3.2 4 5.5 7.1 5.5 10a5.5 5.5 0 0 1-11 0c0-2.9 2.3-6 5.5-10Z"/>'),
  toilets: svg(
    '<circle cx="7" cy="4.5" r="1.6"/><circle cx="17" cy="4.5" r="1.6"/><path d="M5 21v-6H4l1.2-6.5h3.6L10 15H9v6"/><path d="M15 21v-5.5h-1V9h6v6.5h-1V21"/><path d="M12 3v18"/>',
  ),
}

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
}) {
  const container = useRef(null)
  const map = useRef(null)

  // La disponibilité de la carte est un **état**, pas une ref : une ref ne
  // provoque aucun rendu, donc l'effet qui pose les tracés ne serait jamais
  // relancé quand la carte devient prête. C'est aussi ce qui permet de tout
  // reposer après un changement de fond, qui efface sources et couches.
  const [revision, setRevision] = useState(0)

  const handlers = useRef({})
  handlers.current = { onPlace, onPickRoute, onUserMove, placing, compassRef }

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

    instance.on('click', (event) => {
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

  // --- couleurs du tracé selon le fond --------------------------------------
  useEffect(() => {
    const m = map.current
    if (!m || !revision || !m.getLayer('route-line')) return
    const c = TRACE_COLORS[theme]
    m.setPaintProperty('route-line', 'line-color', colorExpression(c))
    m.setPaintProperty('route-halo', 'line-color', c.halo)
    m.setPaintProperty('ghost-line', 'line-color', theme === 'dark' ? '#A8B2BC' : '#3A4550')
  }, [theme, revision])

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

  // --- position en direct + cercle de précision -------------------------------
  const liveMarker = useRef(null)
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
      el.className = 'dot-live'
      liveMarker.current = new maplibregl.Marker({ element: el })
      liveMarker.current.setLngLat(position).addTo(m)
    } else {
      liveMarker.current.setLngLat(position)
    }

    // En course, le repère devient une flèche couchée sur la carte, pointée
    // dans le sens de la course ; au repos, un point droit face à l'écran.
    const pointed = navigate && heading != null
    liveMarker.current.getElement().classList.toggle('dot-live--nav', pointed)
    liveMarker.current.setRotationAlignment(pointed ? 'map' : 'viewport')
    liveMarker.current.setPitchAlignment(pointed ? 'map' : 'viewport')
    liveMarker.current.setRotation(pointed ? heading : 0)

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

  // --- points d'eau et toilettes -------------------------------------------------
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
      el.className = `poi poi--${stop.kind}`
      el.setAttribute('role', 'img')
      el.setAttribute('aria-label', `${stop.kind === 'water' ? "Point d'eau" : 'Toilettes'}${stop.name ? ` — ${stop.name}` : ''}`)
      el.innerHTML = POI_SVG[stop.kind]
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
  }, [cursor, revision])

  // --- tracés -------------------------------------------------------------------
  useEffect(() => {
    const m = map.current
    if (!m || !revision) return

    m.getSource('route')?.setData(routeToGeoJson(route))
    m.getSource('crossings')?.setData(crossingsToGeoJson(route))
    m.getSource('ghost')?.setData(ghostToGeoJson(ghost, route))

    // En course, la carte suit le coureur : un nouveau tracé — un détour — ne
    // doit pas la faire sauter sur une vue d'ensemble.
    if (route?.geometry?.length && !nav.current.navigate) {
      const bounds = route.geometry.reduce(
        (acc, c) => acc.extend(c),
        new maplibregl.LngLatBounds(route.geometry[0], route.geometry[0]),
      )
      m.fitBounds(bounds, { padding: dockPadding(m), duration: 700 })
    }
  }, [route, ghost, revision])

  return (
    <>
      <div ref={container} className="map" />
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

  for (const selector of ['.side', '.stage__top', '.sportpill', '.stage__tools', '.runbar']) {
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

/**
 * Le motif de sens : un chevron isolé sur une bande transparente.
 *
 * Il pointe vers la droite, et MapLibre déroule le motif **dans le sens où la
 * géométrie a été écrite**. Or le backend écrit chaque tronçon dans le sens du
 * parcours : le chevron indique donc la bonne direction sans aucun calcul.
 *
 * La bande est bien plus large que le chevron — c'est ce vide qui espace les
 * répétitions. Un motif serré donnerait une frise illisible ; un motif trop
 * lâche laisserait de longues portions sans indication.
 *
 * Blanc cerné de sombre, et non d'une seule couleur : le tracé change de teinte
 * selon le niveau de sécurité (vert, jaune, orange), le fond change avec le
 * style, et l'imagerie satellite peut être de n'importe quelle couleur sous le
 * trait. Un chevron uni finissait par disparaître quelque part ; celui-ci porte
 * son propre contraste et se lit partout.
 */
function arrowPattern() {
  const width = 96
  const height = 24
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const middle = width / 2

  const stroke = (lineWidth, color) => {
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    ctx.moveTo(middle - 4, 6.5)
    ctx.lineTo(middle + 4, 12)
    ctx.lineTo(middle - 4, 17.5)
    ctx.stroke()
  }

  stroke(7.5, 'rgba(11, 13, 16, 0.85)')
  stroke(3.5, '#FFFFFF')
  return ctx.getImageData(0, 0, width, height)
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

function addLayers(m) {
  const c = TRACE_COLORS.dark

  m.addSource('accuracy', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'accuracy-fill',
    type: 'fill',
    source: 'accuracy',
    paint: { 'fill-color': '#4A9EFF', 'fill-opacity': 0.12 },
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
      'line-color': '#A8B2BC',
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
    paint: { 'line-color': c.halo, 'line-width': 9, 'line-opacity': 0.85 },
  })
  m.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colorExpression(c), 'line-width': 5 },
  })

  // Le sens de parcours. Il n'est pas décoratif : les consignes de navigation,
  // le profil altimétrique et l'orientation par rapport au vent décrivent tous
  // la boucle **dans un sens précis**. La parcourir à l'envers donne les côtes
  // au mauvais moment, le vent de face à la fin, et un guidage qui annonce des
  // virages à gauche là où il faut tourner à droite.
  //
  // Un motif de ligne, et non une couche de symboles. C'est contre-intuitif —
  // `symbol-placement: 'line'` est fait pour ça — mais deux de nos cinq fonds
  // (Relief et Satellite) sont des styles raster écrits à la main, sans champ
  // `glyphs` : ils ne peuvent pas alimenter la chaîne de rendu des symboles.
  // Le motif de ligne ne dépend d'aucune police, se comporte identiquement sur
  // les cinq fonds, et suit la ligne exactement de la même façon.
  if (!m.hasImage('route-chevron')) {
    m.addImage('route-chevron', arrowPattern(), { pixelRatio: 2 })
  }
  m.addLayer({
    id: 'route-arrows',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    // La largeur commande la taille du chevron : le motif est étiré sur la
    // hauteur du trait, et sa répétition suit dans les mêmes proportions.
    paint: { 'line-pattern': 'route-chevron', 'line-width': 12 },
  })

  m.addSource('crossings', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'crossing-dots',
    type: 'circle',
    source: 'crossings',
    paint: {
      'circle-radius': 6,
      'circle-color': '#FFFFFF',
      'circle-stroke-width': 3,
      'circle-stroke-color': ['case', ['get', 'protected'], c.caution, c.risk],
    },
  })

  m.addSource('cursor', { type: 'geojson', data: empty() })
  m.addLayer({
    id: 'cursor-dot',
    type: 'circle',
    source: 'cursor',
    paint: {
      'circle-radius': 7,
      'circle-color': '#8B5CF6',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#FFFFFF',
    },
  })
}

const empty = () => ({ type: 'FeatureCollection', features: [] })

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
