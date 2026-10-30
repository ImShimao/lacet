// La feuille du bas : sa poignée, le geste qui la referme, et la place
// qu'elle prend sur la carte.

import { useEffect, useRef } from 'react'

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
      aria-label={open ? 'Replier le détail' : 'Déplier le détail'}
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
 * Tirer la feuille de détail vers le bas pour la refermer.
 *
 * Quatre choses en font un vrai geste plutôt qu'un raccourci : la feuille suit
 * le doigt pendant qu'on tire, elle ne se referme qu'au-delà d'un seuil — sinon
 * elle revient en place —, elle **glisse vers le bas** en se refermant au lieu
 * de disparaître d'un coup, et le geste part de **n'importe où** : de l'en-tête,
 * ou du contenu lui-même quand il est déjà en haut de sa course. C'est ce que
 * fait n'importe quelle feuille d'iOS, et c'est ce qu'on essaie sans y penser.
 */
export function useSheetDrag(mode, setSheet, shellRef) {
  const drag = useRef(null)
  const CLOSE_M = 64
  // Au-delà de ce glissement, on sait que le doigt descend : avant, ce peut
  // être un défilement qui commence.
  const COMMIT_M = 12

  const shift = (px, closing = false) => {
    const shell = shellRef.current
    if (!shell) return
    if (px === null) {
      shell.style.removeProperty('--sheet-drag')
      delete shell.dataset.dragging
      delete shell.dataset.closing
      return
    }
    shell.style.setProperty('--sheet-drag', `${px}px`)
    if (closing) shell.dataset.closing = 'yes'
    else shell.dataset.dragging = 'yes'
  }

  const travel = (e) => e.clientY - drag.current.y

  /**
   * `fromBody` : le geste part du contenu, qui défile. On ne prend la main
   * qu'une fois sûr qu'il descend **et** que la liste est déjà en haut ;
   * autrement on laisserait la feuille partir pendant qu'on lit.
   */
  const handlers = (fromBody = false) => ({
    onPointerDown: (e) => {
      if (mode !== 'full') return
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      const scroller = fromBody ? e.currentTarget : null
      if (scroller && scroller.scrollTop > 0) return
      // Un bouton de l'en-tête — la pastille d'activité, qui ouvre les filtres —
      // doit recevoir son toucher : capturé d'emblée, le doigt n'arrivait
      // qu'à l'en-tête, et le bouton restait mort. On attend, comme depuis le
      // contenu, d'être sûr que le doigt tire vers le bas.
      const pressed = !fromBody && e.target instanceof Element && Boolean(e.target.closest('button:not(.grabber)'))
      const live = !fromBody && !pressed
      drag.current = {
        y: e.clientY,
        scroller,
        live,
        grip: e.target instanceof Element && Boolean(e.target.closest('.grabber')),
      }
      if (live) e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e) => {
      if (!drag.current) return
      const dy = travel(e)
      if (!drag.current.live) {
        if (dy < COMMIT_M || drag.current.scroller?.scrollTop > 0) return
        drag.current.live = true
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
      // Vers le haut, rien ne bouge : la feuille est déjà en butée.
      shift(Math.max(0, dy))
    },
    onPointerUp: (e) => {
      if (!drag.current) return
      const dy = travel(e)
      const { grip, live } = drag.current
      drag.current = null
      if ((live && dy > CLOSE_M) || (grip && Math.abs(dy) < 8)) {
        // La feuille finit sa course avant de rendre la place : fermée d'un
        // coup, on ne comprend pas ce qui vient de se passer.
        shift(Math.max(dy, CLOSE_M) + 260, true)
        setTimeout(() => {
          setSheet('peek')
          shift(null)
        }, 180)
        return
      }
      shift(null)
    },
    onPointerCancel: () => {
      drag.current = null
      shift(null)
    },
  })

  return handlers
}

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
