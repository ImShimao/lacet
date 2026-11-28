/**
 * La visite guidée : après les trois pages d'accueil, des bulles posées sur
 * l'écran lui-même montrent où sont les choses — le départ, la longueur, les
 * filtres, le bouton qui cherche. Les pages disaient ce que fait l'app ; elles
 * ne montraient pas où toucher.
 *
 * Une fois, comme l'accueil. Chaque bulle éclaire son élément (le reste de
 * l'écran s'assombrit) et se pose dessous, ou dessus s'il n'y a pas la place.
 * Un élément absent — pas de règle en mode trajet, par exemple — est sauté.
 */

import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from './i18n'

const KEY = 'lacet.visite'
// Après le lancement animé, comme l'accueil (`Welcome.jsx`).
const SHOW_AFTER_MS = 1900
// L'éclairage déborde un peu de l'élément, et la bulle garde 16 px du bord.
const HALO = 6
const EDGE = 16
const GAP = 14

export const STEPS = [
  { target: '.search', title: 'Le départ', text: 'Cherche une adresse, ou pars de ta position avec le bouton à droite.' },
  { target: '.ruler', title: 'La longueur', text: 'Fais glisser la règle, ou touche une distance toute prête. « Durée » règle le temps de course à la place.' },
  { target: '.sportpill', title: 'Les filtres', text: 'Sport, terrain, relief, allure : ce que tu veux sous tes pieds.' },
  { target: '.tool--start', title: 'Ton parcours', text: 'Change de départ, passe par un point précis ou évite une zone.' },
  { target: '.tool--free', title: 'Courir libre', text: 'Pars sans tracé, juste pour courir : la sortie s\'enregistre quand même.' },
  { target: '.panel .btn--big', title: 'Trouver ma boucle', text: 'Lacet propose plusieurs boucles, notées A, B ou C selon leur sécurité.' },
  { target: '.side__tabs', title: 'Tes sorties et tes réglages', text: 'Mes parcours garde tes favoris et tes sorties ; Mon compte, ton profil et tes réglages.' },
]

export function tourSeen() {
  try {
    return localStorage.getItem(KEY) === 'oui'
  } catch {
    return false
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, 'oui')
  } catch {
    // Sans stockage, la visite reviendra : rien ne casse.
  }
}

/**
 * Où poser la bulle : sous l'élément s'il reste assez de place, sinon dessus ;
 * la flèche vise le milieu de l'élément, même quand la bulle bute sur un bord.
 */
export function placeBubble(rect, view, width = 320, height = 170) {
  const w = Math.min(width, view.w - 2 * EDGE)
  const below = view.h - rect.bottom - HALO - GAP >= height
  const left = Math.min(view.w - EDGE - w, Math.max(EDGE, rect.left + rect.width / 2 - w / 2))
  const arrow = Math.min(w - 24, Math.max(24, rect.left + rect.width / 2 - left))
  return below
    ? { below, left, width: w, top: rect.bottom + HALO + GAP, arrow }
    : { below, left, width: w, bottom: view.h - rect.top + HALO + GAP, arrow }
}

export default function Tour({ onDone = () => {} }) {
  const [open, setOpen] = useState(false)
  const [steps, setSteps] = useState([])
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)

  // Les étapes dont l'élément est à l'écran, relevées à l'ouverture.
  useLayoutEffect(() => {
    if (tourSeen()) return undefined
    const timer = setTimeout(() => {
      const shown = STEPS.filter((s) => document.querySelector(s.target))
      if (!shown.length) return
      setSteps(shown)
      setOpen(true)
    }, SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])

  const step = steps[i]
  useLayoutEffect(() => {
    if (!open || !step) return undefined
    const measure = () => {
      const el = document.querySelector(step.target)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, step])

  if (!open || !step || !rect) return null

  const finish = () => {
    remember()
    setOpen(false)
    onDone()
  }
  const last = i === steps.length - 1
  const view = { w: window.innerWidth, h: window.innerHeight }
  const place = placeBubble(rect, view)

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* La clé rejoue le fondu à chaque bulle : l'éclairage saute d'un élément
          à l'autre au lieu de glisser, mais sans rien recalculer pendant. */}
      <div
        key={`hole-${i}`}
        className="tour__hole"
        style={{ left: rect.left - HALO, top: rect.top - HALO, width: rect.width + 2 * HALO, height: rect.height + 2 * HALO }}
      />
      <div
        key={`bubble-${i}`}
        className={`tour__bubble ${place.below ? 'tour__bubble--below' : 'tour__bubble--above'}`}
        style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, '--arrow': `${place.arrow}px` }}
      >
        <h2 id="tour-title">{t(step.title)}</h2>
        <p>{t(step.text)}</p>
        <div className="tour__foot">
          <span className="tour__count">
            {i + 1} / {steps.length}
          </span>
          {!last && (
            <button className="tour__skip" onClick={finish}>
              {t('Passer')}
            </button>
          )}
          <button className="btn btn--primary tour__next" onClick={last ? finish : () => setI(i + 1)}>
            {last ? t('C\'est parti') : t('Suivant')}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('root') ?? document.body,
  )
}
