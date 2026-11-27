// La feuille du bas : sa poignée, le geste qui la referme, et la place
// qu'elle prend sur la carte.

import { useEffect, useRef } from 'react'
import { haptic } from './platform'

import { t } from './i18n'
/**
 * La poignée de la feuille.
 *
 * Elle ne porte que le repère visuel et le clavier : le geste, lui, est écouté
 * par **tout l'en-tête** de la feuille (voir `useSheetDrag`). Viser une barre
 * de quarante pixels en courant, ou d'une main dans le métro, ne marchait pas ;
 * on tire maintenant n'importe où dans le bandeau du haut, et la feuille suit
 * le doigt avant de se refermer.
 */
export function SheetGrabber({ open, onSet }) {
  return (
    <button
      type="button"
      className="grabber"
      aria-label={open ? t('Replier le détail') : t('Déplier le détail')}
      aria-expanded={open}
      // Le doigt passe par l'en-tête ; ici, seul le clavier — VoiceOver, un
      // clavier Bluetooth (`detail` vaut 0) — sinon le geste compterait deux fois.
      onClick={(e) => e.detail === 0 && onSet(open ? 'peek' : 'full')}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onSet('full')
        else if (e.key === 'ArrowDown') onSet('peek')
        else return
        e.preventDefault()
      }}
    />
  )
}

/**
 * Tirer la feuille de détail vers le bas pour la refermer, ou la feuille
 * repliée vers le haut pour l'ouvrir.
 *
 * Quatre choses en font un vrai geste plutôt qu'un raccourci : la feuille suit
 * le doigt pendant qu'on tire, elle ne se referme qu'au-delà d'un seuil — sinon
 * elle revient en place —, elle **glisse vers le bas** en se refermant au lieu
 * de disparaître d'un coup, et le geste part de **n'importe où** : de l'en-tête,
 * ou du contenu lui-même quand il est déjà en haut de sa course. C'est ce que
 * fait n'importe quelle feuille d'iOS, et c'est ce qu'on essaie sans y penser.
 */
export function useSheetDrag(mode, setSheet, shellRef, { canOpen = false } = {}) {
  const drag = useRef(null)
  // Où en est la feuille, en pixels sous sa place, et l'animation en cours.
  const offset = useRef(0)
  const anim = useRef(0)

  const shift = (px) => {
    const shell = shellRef.current
    offset.current = px ?? 0
    if (!shell) return
    if (px === null) {
      shell.style.removeProperty('--sheet-drag')
      delete shell.dataset.dragging
      return
    }
    shell.style.setProperty('--sheet-drag', `${px}px`)
    shell.dataset.dragging = 'yes'
  }

  const stop = () => {
    cancelAnimationFrame(anim.current)
    anim.current = 0
  }

  /**
   * La feuille lâchée finit son mouvement en JS, image par image, et jamais par
   * une transition CSS : reprise en plein vol, elle part de là où elle est au
   * lieu de sauter à la fin de sa course. `velocity` en pixels par seconde.
   */
  const settle = (to, velocity, done) => {
    stop()
    if (reducedMotion()) {
      shift(to === 0 ? null : to)
      done?.()
      return
    }
    let x = offset.current
    let v = velocity
    let last = null
    const closing = to !== 0
    const frame = (now) => {
      const dt = last === null ? 1 / 60 : Math.min(0.032, (now - last) / 1000)
      last = now
      if (closing) {
        // La fermeture garde l'élan du doigt, sans jamais traîner : la place
        // revient à la carte en un quart de seconde au plus.
        v = Math.max(v, CLOSE_MIN_SPEED)
        x += v * dt
      } else {
        // Le retour en place : un ressort presque amorti, comme les feuilles
        // d'iOS — il part avec la vitesse du doigt et se pose sans rebond.
        const a = -SPRING_K * (x - to) - SPRING_C * v
        v += a * dt
        x += v * dt
      }
      const arrived = closing ? x >= to : Math.abs(x - to) < 0.5 && Math.abs(v) < 20
      if (arrived) {
        anim.current = 0
        shift(closing ? to : null)
        done?.()
        return
      }
      shift(x)
      anim.current = requestAnimationFrame(frame)
    }
    anim.current = requestAnimationFrame(frame)
  }

  const close = (velocity) => {
    const side = shellRef.current?.querySelector('.side')
    const height = side?.offsetHeight || 600
    settle(height, velocity, () => {
      haptic('tickHaptic')
      setSheet('peek')
      shift(null)
    })
  }

  /** La vitesse du doigt au lâcher, en pixels par seconde ; nulle s'il s'est arrêté. */
  const speed = () => {
    const d = drag.current
    if (!d.prev || Date.now() - d.last.t > 100) return 0
    const dt = Math.max(1, d.last.t - d.prev.t)
    return ((d.last.y - d.prev.y) / dt) * 1000
  }

  /**
   * `fromBody` : le geste part du contenu, qui défile. On ne prend la main
   * qu'une fois sûr qu'il descend **et** que la liste est déjà en haut ;
   * autrement on laisserait la feuille partir pendant qu'on lit.
   *
   * Repliée, la feuille se tire aussi vers le haut, depuis les cartes de
   * boucle, pour ouvrir le détail : c'est le geste qu'on essaie d'abord sur
   * iPhone. Le doigt doit alors monter franchement, sinon il fait défiler
   * les cartes de côté.
   */
  const handlers = (fromBody = false) => ({
    onPointerDown: (e) => {
      const opening = mode === 'peek' && canOpen && fromBody
      if (mode !== 'full' && !opening) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      const scroller = fromBody && !opening ? e.currentTarget : null
      if (scroller && scroller.scrollTop > 0) return
      // Un bouton de l'en-tête — la pastille d'activité, qui ouvre les filtres —
      // doit recevoir son toucher : capturé d'emblée, le doigt n'arrivait
      // qu'à l'en-tête, et le bouton restait mort. On attend, comme depuis le
      // contenu, d'être sûr que le doigt tire vers le bas.
      const pressed = !fromBody && e.target instanceof Element && Boolean(e.target.closest('button:not(.grabber)'))
      // Reprise en plein vol : la feuille s'arrête sous le doigt et repart de là.
      const caught = anim.current !== 0
      stop()
      const live = (!fromBody && !pressed) || caught
      const now = { y: e.clientY, t: Date.now() }
      drag.current = {
        y: e.clientY - offset.current,
        x: e.clientX,
        scroller,
        live,
        opening,
        last: now,
        prev: null,
        grip: e.target instanceof Element && Boolean(e.target.closest('.grabber')),
      }
      if (live) e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (!d) return
      const dy = e.clientY - d.y
      d.prev = d.last
      d.last = { y: e.clientY, t: Date.now() }
      if (!d.live) {
        const dx = Math.abs(e.clientX - d.x)
        if (d.opening) {
          if (-dy < COMMIT_M || dx > -dy) return
        } else if (dy < COMMIT_M || d.scroller?.scrollTop > 0) return
        d.live = true
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
      // Repliée, elle monte avec résistance ; dépliée, elle est en butée vers
      // le haut et ne bouge que vers le bas.
      shift(d.opening ? -rubber(-Math.min(0, dy)) : Math.max(0, dy))
    },
    onPointerUp: (e) => {
      const d = drag.current
      if (!d) return
      const dy = e.clientY - d.y
      const v = speed()
      drag.current = null
      if (d.opening) {
        // Un coup de pouce vers le haut suffit, sans aller jusqu'au seuil.
        if (d.live && (-dy > OPEN_M || (v < -FLICK_SPEED && -dy > 8))) {
          haptic('tickHaptic')
          shift(null)
          setSheet('full')
          return
        }
        if (d.live) settle(0, v)
        return
      }
      const flick = v > FLICK_SPEED && dy > 8
      if ((d.live && (dy > CLOSE_M || flick)) || (d.grip && Math.abs(dy) < 8)) {
        close(Math.max(0, v))
        return
      }
      if (d.live) settle(0, v)
    },
    onPointerCancel: () => {
      if (!drag.current) return
      drag.current = null
      settle(0, 0)
    },
  })

  return handlers
}

// Au-delà de ce glissement, on sait dans quel sens va le doigt : avant, ce peut
// être un défilement qui commence.
const COMMIT_M = 12
const CLOSE_M = 64
const OPEN_M = 56
// Un coup sec ferme ou ouvre la feuille quelle que soit la distance parcourue :
// 500 px/s, la vitesse d'un pouce qui chasse une feuille d'iOS.
const FLICK_SPEED = 500
// La fermeture ne descend jamais sous 1 800 px/s : 600 px en un tiers de seconde.
const CLOSE_MIN_SPEED = 1800
// Raideur et amortissement du ressort de retour : amorti à 90 %, il se pose
// en un tiers de seconde environ, sans rebond.
const SPRING_K = 380
const SPRING_C = 2 * Math.sqrt(SPRING_K) * 0.9

/** Tirer au-delà de la butée : la feuille suit de moins en moins, comme sur iOS. */
const rubber = (px) => 120 * (1 - 1 / (px / 220 + 1))

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Hauteur de carte recouverte par le panneau, en variable CSS
 * (`--sheet-cover`) : l'attribution et la consigne de placement se posent
 * juste au-dessus, au lieu de passer sous les cartes de parcours. Mesurée
 * plutôt que calculée — elle dépend du contenu, de l'onglet, et de la feuille
 * repliée ou non.
 */
export function useSheetCover(shellRef) {
  useEffect(() => {
    const shell = shellRef.current
    const side = shell?.querySelector('.side')
    if (!side) return undefined
    const update = () => {
      const cover = shell.clientHeight - side.offsetTop
      shell.style.setProperty('--sheet-cover', `${Math.max(0, Math.round(cover))}px`)
    }
    const observer = new ResizeObserver(update)
    observer.observe(side)
    observer.observe(shell)
    update()
    return () => observer.disconnect()
  }, [shellRef])
}
