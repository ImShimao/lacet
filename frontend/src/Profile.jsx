/**
 * Le profil : qui l'on est (photo, pseudo), son corps (taille, poids) et ses
 * objectifs. Tout reste sur le téléphone, comme le reste de Mon compte.
 *
 * La photo se recadre avant d'être gardée : une photo prise au hasard met
 * rarement le visage au centre d'un rond. Elle est ramenée à 320 px de côté —
 * une vingtaine de kilo-octets — pour tenir dans les cinq mégaoctets du
 * stockage à côté des sorties.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { PrefsCard } from './Prefs.jsx'
import { load, save } from './storage'
import { t } from './i18n'

/** Le pseudo et la photo, gardés à part des réglages de recherche. */
export function useIdentity() {
  const [me, setMe] = useState(() => ({ name: load().profileName ?? '', photo: load().profilePhoto ?? null }))
  return [
    me,
    (patch) => {
      setMe((cur) => ({ ...cur, ...patch }))
      save({
        ...('name' in patch ? { profileName: patch.name } : {}),
        ...('photo' in patch ? { profilePhoto: patch.photo } : {}),
      })
    },
  ]
}

/** L'avatar : la photo si l'on en a mis une, l'icône du sport sinon. */
export function Avatar({ photo, icon = 'user', size = 24 }) {
  return (
    <span className={`acct__avatar ${photo ? 'acct__avatar--photo' : ''}`}>
      {photo ? <img src={photo} alt="" /> : <Icon name={icon} size={size} />}
    </span>
  )
}

/** Qui l'on est, son corps, ses objectifs : trois cartes de réglages. */
export function ProfileSettings({ params, onProfile }) {
  const [me, setMe] = useIdentity()
  const [picked, setPicked] = useState(null)

  return (
    <>
      {/* Qui l'on est, en carte de visite : la photo en grand, qu'on touche
          pour la changer, et le pseudo dessous. Trois lignes de réglage —
          avatar minuscule, « Changer de photo », « Retirer la photo » — se
          lisaient comme une liste d'options, pas comme un profil. */}
      <section className="ident" aria-label={t('Identité')}>
        <label className="ident__photo" aria-label={me.photo ? t('Changer de photo') : t('Ajouter une photo')}>
          <Avatar photo={me.photo} size={34} />
          <span className="ident__badge" aria-hidden="true">
            <Icon name={me.photo ? 'refresh' : 'plus'} size={15} />
          </span>
          <input
            type="file"
            id="me-photo"
            accept="image/*"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) setPicked(URL.createObjectURL(file))
              // Rechoisir la même photo doit rouvrir le recadrage.
              e.target.value = ''
            }}
          />
        </label>
        <input
          className="ident__name"
          type="text"
          autoComplete="nickname"
          enterKeyHint="done"
          maxLength={30}
          aria-label={t('Pseudo')}
          placeholder={t('Pseudo')}
          value={me.name}
          onChange={(e) => setMe({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
        {me.photo ? (
          <button className="ident__remove" onClick={() => setMe({ photo: null })}>
            {t('Retirer la photo')}
          </button>
        ) : (
          <label htmlFor="me-photo" className="ident__hint">{t('Ajouter une photo')}</label>
        )}
      </section>

      <PrefsCard title={t('Corps')} foot={t('Le poids sert à estimer les calories d\'une sortie, et rien d\'autre. Rien n\'est envoyé.')}>
        <NumberRow icon="ruler" label={t('Taille')} unit="cm" value={params.height_cm || 170} min={120} max={220} onChange={(height_cm) => onProfile({ height_cm })} />
        <NumberRow icon="gauge" label={t('Poids')} unit={t('kg')} value={params.weight_kg || 70} min={30} max={200} onChange={(weight_kg) => onProfile({ weight_kg })} />
      </PrefsCard>

      <PrefsCard title={t('Objectifs')} foot={t('Les objectifs s\'affichent en tête de tes sorties, avec ce qu\'il reste à courir. À 0, pas d\'objectif.')}>
        <NumberRow icon="flag" label={t('Objectif par semaine')} unit="km" value={params.weekly_km || 0} min={0} max={300} onChange={(weekly_km) => onProfile({ weekly_km })} />
        <NumberRow icon="trendUp" label={t('Objectif par mois')} unit="km" value={params.monthly_km || 0} min={0} max={1000} onChange={(monthly_km) => onProfile({ monthly_km })} />
      </PrefsCard>

      {picked && (
        <PhotoCropper
          src={picked}
          onCancel={() => {
            URL.revokeObjectURL(picked)
            setPicked(null)
          }}
          onDone={(photo) => {
            URL.revokeObjectURL(picked)
            setPicked(null)
            setMe({ photo })
          }}
        />
      )}
    </>
  )
}

const VIEW = 260
const OUT = 320
const MAX_ZOOM = 4

/** Garde l'image sous tout le rond : jamais de bande vide sur un bord. */
export function clampOffset(x, y, w, h) {
  return { x: Math.min(0, Math.max(VIEW - w, x)), y: Math.min(0, Math.max(VIEW - h, y)) }
}

/**
 * Le recadrage : la photo sous un rond, qu'on fait glisser du doigt et qu'on
 * agrandit en pinçant — ou au curseur, pour qui tient le téléphone d'une main.
 * La photo bouge par `transform` seulement : rien ne se recalcule sous le doigt.
 */
export function PhotoCropper({ src, onCancel, onDone }) {
  const [img, setImg] = useState(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const pointers = useRef(new Map())
  const gesture = useRef(null)

  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      setImg(image)
      const base = VIEW / Math.min(image.naturalWidth, image.naturalHeight)
      setView({ x: (VIEW - image.naturalWidth * base) / 2, y: (VIEW - image.naturalHeight * base) / 2, zoom: 1 })
    }
    image.src = src
  }, [src])

  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1
  const scale = base * view.zoom

  // Le zoom se fait autour d'un point du rond, qui reste sous le doigt (ou au centre, au curseur).
  const zoomTo = (cur, zoom, cx = VIEW / 2, cy = VIEW / 2) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, zoom))
    const s0 = base * cur.zoom
    const s1 = base * z
    const ix = (cx - cur.x) / s0
    const iy = (cy - cur.y) / s0
    const o = clampOffset(cx - ix * s1, cy - iy * s1, img.naturalWidth * s1, img.naturalHeight * s1)
    return { ...o, zoom: z }
  }

  const local = (e, el) => {
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const down = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, local(e, e.currentTarget))
    gesture.current = null
  }
  const move = (e) => {
    if (!img || !pointers.current.has(e.pointerId)) return
    const prev = new Map(pointers.current)
    pointers.current.set(e.pointerId, local(e, e.currentTarget))
    const pts = [...pointers.current.values()]
    if (pts.length === 1) {
      const p0 = prev.get(e.pointerId)
      const p1 = pts[0]
      setView((cur) => ({ ...cur, ...clampOffset(cur.x + p1.x - p0.x, cur.y + p1.y - p0.y, img.naturalWidth * base * cur.zoom, img.naturalHeight * base * cur.zoom) }))
    } else if (pts.length >= 2) {
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      if (!gesture.current) gesture.current = { dist, zoom: view.zoom }
      // Le geste est lu maintenant, pas dans la mise à jour : React la joue plus
      // tard, et un doigt levé entre-temps l'avait remis à `null` — l'app
      // tombait sur « null is not an object (gesture.current.zoom) ».
      const zoom = (gesture.current.zoom * dist) / gesture.current.dist
      setView((cur) => zoomTo(cur, zoom, mid.x, mid.y))
    }
  }
  const up = (e) => {
    pointers.current.delete(e.pointerId)
    gesture.current = null
  }

  const done = () => {
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    canvas.getContext('2d').drawImage(img, -view.x / scale, -view.y / scale, VIEW / scale, VIEW / scale, 0, 0, OUT, OUT)
    onDone(canvas.toDataURL('image/jpeg', 0.85))
  }

  // Hors du panneau : dedans, la barre d'onglets passait par-dessus « Valider ».
  return createPortal(
    <div className="modal" onClick={onCancel}>
      <div className="modal__panel crop" role="dialog" aria-modal="true" aria-label={t('Recadrer la photo')} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span />
          <h2>{t('Recadrer la photo')}</h2>
          <span />
        </div>
        <div className="modal__body crop__body">
          <div
            className="crop__view"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {img && (
              <img
                src={src}
                alt=""
                draggable={false}
                style={{ width: img.naturalWidth, height: img.naturalHeight, transform: `translate(${view.x}px, ${view.y}px) scale(${scale})` }}
              />
            )}
            <span className="crop__ring" aria-hidden="true" />
          </div>
          <p className="muted small">{t('Fais glisser pour recentrer, pince pour zoomer.')}</p>
          <label className="crop__zoom">
            <Icon name="minus" size={15} />
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              aria-label={t('Zoom')}
              value={view.zoom}
              disabled={!img}
              onChange={(e) => setView((cur) => zoomTo(cur, Number(e.target.value)))}
            />
            <Icon name="plus" size={15} />
          </label>
        </div>
        <div className="modal__foot">
          <button className="btn" onClick={onCancel}>{t('Annuler')}</button>
          <button className="btn btn--primary" onClick={done} disabled={!img}>
            <Icon name="check" size={17} />
            {t('Valider')}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('root') ?? document.body,
  )
}

/**
 * Un appui maintenu répète le pas, de plus en plus vite.
 *
 * Passer de 70 à 82 kg demandait douze appuis, et de 175 à 194 cm dix-neuf.
 * La valeur est lue dans une référence à chaque répétition : la lire dans la
 * fermeture figerait le premier chiffre, et tous les pas suivants
 * réécriraient la même valeur.
 */
function useHold(step, delays = { first: 420, min: 55 }) {
  const timer = useRef(null)
  const action = useRef(step)
  action.current = step

  const stop = () => {
    clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])

  const start = (event) => {
    // Un seul doigt, et pas de sélection ni de zoom déclenchés par l'appui long.
    event.preventDefault()
    // Un second doigt lançait une seconde répétition sans arrêter la première :
    // lever la main n'en arrêtait qu'une, et le poids filait jusqu'à sa borne,
    // réécrit sur le disque vingt fois par seconde.
    stop()
    action.current()
    let delay = delays.first
    const tick = () => {
      action.current()
      delay = Math.max(delays.min, delay * 0.72)
      timer.current = setTimeout(tick, delay)
    }
    timer.current = setTimeout(tick, delay)
  }

  // `detail` vaut zéro quand le clic vient du clavier (Entrée ou Espace sur le
  // bouton) : là, aucun événement de pointeur n'est émis, et le pas ne se ferait
  // jamais. À la souris ou au doigt, l'appui l'a déjà fait.
  const onClick = (event) => {
    if (event.detail === 0) action.current()
  }

  return { onClick, onPointerDown: start, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop }
}

/**
 * Une valeur chiffrée : au doigt par les deux boutons, au clavier en touchant
 * le nombre.
 *
 * Le nombre est un champ, et pas seulement un affichage : douze appuis pour
 * corriger un poids est le genre de détail qui fait renoncer à régler quoi que
 * ce soit. Ce qui est saisi n'est pris qu'à la validation, et ramené dans les
 * bornes — un champ vidé le temps de retaper ne doit pas valoir « 0 kg ».
 */
function NumberRow({ icon, label, unit, value, min, max, onChange }) {
  const [draft, setDraft] = useState(null)
  const moins = useHold(() => onChange(Math.max(min, value - 1)))
  const plus = useHold(() => onChange(Math.min(max, value + 1)))

  const commit = () => {
    const saisi = Number(draft)
    setDraft(null)
    if (draft !== null && draft !== '' && Number.isFinite(saisi)) {
      onChange(Math.min(max, Math.max(min, Math.round(saisi))))
    }
  }

  return (
    <div className="prow">
      <div className="prow__btn prow__static">
        {icon && <Icon name={icon} size={19} className="prow__icon" />}
        <span className="prow__text">
          <b>{label}</b>
        </span>
        <span className="rows__num">
          <button {...moins} aria-label={t('Diminuer {v1}', { v1: label.toLowerCase() })}>
            <Icon name="minus" size={15} />
          </button>
          <label className="rows__field">
            <input
              type="text"
              inputMode="numeric"
              enterKeyHint="done"
              aria-label={t('{label} en {v2}', { label, v2: t({ kg: 'kilogrammes', km: 'kilomètres' }[unit] ?? 'centimètres') })}
              value={draft ?? value}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onFocus={(e) => e.target.select()}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            />
            <b>{unit}</b>
          </label>
          <button {...plus} aria-label={t('Augmenter {v1}', { v1: label.toLowerCase() })}>
            <Icon name="plus" size={15} />
          </button>
        </span>
      </div>
    </div>
  )
}

