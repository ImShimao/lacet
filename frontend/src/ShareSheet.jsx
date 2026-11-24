import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import useModal from './useModal'
import { shareText } from './contact'
import { shareDataUrl, figuresOf, templatesFor } from './shareCard'

import { t } from './i18n'
/**
 * Partager une sortie : choisir l'image, la voir en grand, puis l'envoyer.
 *
 * Le bouton « Partager » ouvrait directement la feuille d'iOS sur une seule
 * carte. Pour une story, il faut autre chose : un autocollant à fond
 * transparent, qu'on copie ici et qu'on colle sur sa photo dans Instagram ou
 * Snapchat. D'où plusieurs modèles, un aperçu sur damier pour voir ce qui est
 * transparent, et deux gestes : « Copier » pour coller, « Partager » pour tout
 * le reste — Messages, Enregistrer l'image, les apps de réseau.
 *
 * Les images sont dessinées une à une après l'ouverture : la feuille apparaît
 * tout de suite, et chaque vignette arrive quand elle est prête.
 */
export default function ShareSheet({ entry, verdict = null, onClose }) {
  const panel = useModal(onClose)
  const templates = useMemo(() => templatesFor(entry), [entry])
  const [choice, setChoice] = useState(templates[0].key)
  const [images, setImages] = useState({})
  const [note, setNote] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      for (const t of templates) {
        // Rendre la main entre deux dessins : l'animation d'ouverture ne saccade pas.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (!alive) return
        let url = null
        try {
          url = t.draw(document.createElement('canvas'), entry, verdict).toDataURL('image/png')
        } catch {
          /* pas de canevas (vieux système, test) : la vignette reste vide */
        }
        setImages((shown) => ({ ...shown, [t.key]: url }))
      }
    })()
    return () => {
      alive = false
    }
  }, [templates, entry, verdict])

  const current = templates.find((t) => t.key === choice)
  const image = images[choice]

  const share = async () => {
    try {
      if (!image) throw new Error('image absente')
      await shareDataUrl(image, entry.name || t('Ma sortie'))
    } catch (error) {
      // Refermer la feuille d'iOS n'est pas une panne. Une image qui ne se
      // fait pas, si : le texte part à sa place, plutôt que rien.
      if (/cancel/i.test(error?.message || '')) return
      shareText(t('{name} — {v2} — avec Lacet', { name: entry.name, v2: figuresOf(entry).map(([v]) => v).join(' · ') }), t('Ma sortie'))
    }
  }

  const copy = async () => {
    try {
      // La promesse va dans le `ClipboardItem` plutôt qu'attendue avant : Safari
      // n'accepte d'écrire que pendant le geste, et une attente l'aurait fini.
      const blob = fetch(image).then((r) => r.blob())
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setNote(current.clear ? t('Copiée. Dans ta story, appuie longuement puis « Coller ».') : t('Image copiée.'))
    } catch {
      setNote(t('La copie n’a pas marché : passe par « Partager », puis « Copier ».'))
    }
  }

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel sharesheet"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('Partager la sortie')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <button className="mapsheet__close" onClick={onClose} aria-label={t('Fermer')}>
            <Icon name="close" size={18} />
          </button>
          <h2>{t('Partager')}</h2>
          <span />
        </div>

        <div className="modal__body">
          <div className="sharesheet__stage" data-clear={current.clear || undefined}>
            {image ? <img src={image} alt={t('Aperçu : {label}', { label: current.label })} /> : <span className="sharesheet__wait">{t('Préparation…')}</span>}
          </div>
          <p className="sharesheet__hint" aria-live="polite">
            {note ?? current.hint}
          </p>

          <div className="sharesheet__strip" role="radiogroup" aria-label={t('Modèles d\'image')}>
            {templates.map((tpl) => (
              <button
                key={tpl.key}
                role="radio"
                aria-checked={choice === tpl.key}
                className="sharesheet__opt"
                onClick={() => {
                  setChoice(tpl.key)
                  setNote(null)
                }}
                data-autofocus={choice === tpl.key || undefined}
              >
                <span className="sharesheet__thumb" data-clear={tpl.clear || undefined}>
                  {images[tpl.key] && <img src={images[tpl.key]} alt="" />}
                </span>
                {t(tpl.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="modal__foot">
          <button className="btn" onClick={copy} disabled={!image}>
            <Icon name="copy" size={17} />{t('Copier')}</button>
          <button className="btn btn--primary" onClick={share}>
            <Icon name="share" size={17} />{t('Partager')}</button>
        </div>
      </div>
    </div>,
    document.getElementById('root') ?? document.body,
  )
}
