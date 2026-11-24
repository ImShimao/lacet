import Icon from './Icon.jsx'

import { t } from './i18n'
/** Les trois onglets, en gélule flottante au bas de l'écran. */
export default function TabBar({ tab, sportIcon, onChange }) {
  return (
    <nav className="side__tabs">
      {[
        ['routes', 'routes', t('Mes parcours')],
        ['explore', sportIcon, t('Explorer')],
        ['account', 'user', t('Mon compte')],
      ].map(([key, icon, label]) => (
        <button key={key} className={`tab ${tab === key ? 'tab--on' : ''}`} onClick={() => onChange(key)}>
          <Icon name={icon} size={19} />
          {label}
        </button>
      ))}
    </nav>
  )
}
