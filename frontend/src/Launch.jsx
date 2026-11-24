/**
 * L'ouverture de l'app : la boucle se trace depuis son départ, le nom arrive,
 * puis tout s'efface sur la carte.
 *
 * Elle prend le relais de l'écran de lancement d'iOS, qui montre la même marque
 * immobile sur le même fond : on ne voit pas de coupure, la marque se met
 * seulement à bouger. Un toucher la passe ; l'app tourne déjà dessous.
 */

import { useEffect, useState } from 'react'
import Logo from './Logo.jsx'

import { t } from './i18n'
const SHOWN_MS = 1500
const FADE_MS = 350

export default function Launch() {
  const [stage, setStage] = useState('in')

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const out = setTimeout(() => setStage('out'), reduced ? 300 : SHOWN_MS)
    return () => clearTimeout(out)
  }, [])

  useEffect(() => {
    if (stage !== 'out') return undefined
    const gone = setTimeout(() => setStage('gone'), FADE_MS)
    return () => clearTimeout(gone)
  }, [stage])

  if (stage === 'gone') return null
  return (
    <div className={`launch launch--${stage}`} onPointerDown={() => setStage('out')} aria-hidden="true">
      <Logo size={132} className="launch__mark" />
      <b className="launch__name">Lacet</b>
      <span className="launch__tag">{t('Des boucles sûres, depuis ta porte')}</span>
    </div>
  )
}
