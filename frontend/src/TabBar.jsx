import Icon from './Icon.jsx'

/** Les trois onglets, en gélule flottante au bas de l'écran. */
export default function TabBar({ tab, sportIcon, onChange }) {
  return (
    <nav className="side__tabs">
      {[
        ['routes', 'routes', 'Mes parcours'],
        ['explore', sportIcon, 'Explorer'],
        ['account', 'user', 'Mon compte'],
      ].map(([key, icon, label]) => (
        <button key={key} className={`tab ${tab === key ? 'tab--on' : ''}`} onClick={() => onChange(key)}>
          <Icon name={icon} size={19} />
          {label}
        </button>
      ))}
    </nav>
  )
}
