import { useState } from 'react'
import { createPortal } from 'react-dom'
import useModal from './useModal'

import { t } from './i18n'
/**
 * Nommer un point de départ pour le retrouver d'un geste.
 *
 * On part presque toujours des mêmes endroits — de chez soi, du bureau, du
 * parking du club — et retaper l'adresse à chaque fois est le genre de friction
 * qui décide, certains soirs, de ne pas sortir.
 */
export default function PlaceSheet({ suggestion, onSave, onClose }) {
  const [name, setName] = useState(suggestion || '')
  const panel = useModal(onClose)

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t('Enregistrer ce départ')}>
      <div className="sheet__panel" ref={panel} tabIndex={-1}>
        <h3>{t('Enregistrer ce départ')}</h3>
        <p className="muted">{t('Il apparaîtra dans le menu du point de départ, et restera sur cet appareil.')}</p>
        <input
          className="field"
          type="text"
          autoCapitalize="sentences"
          autoCorrect="off"
          placeholder={t('Chez moi, Le boulot, Le club…')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onSave(name.trim())
          }}
        />
        <div className="row">
          <button className="btn" onClick={onClose}>{t('Annuler')}</button>
          <button className="btn btn--primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>{t('Enregistrer')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
