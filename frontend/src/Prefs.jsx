/**
 * Les lignes de réglage, à la manière des Préférences de RunnrZ et des boutons
 * à menu d'iOS : une icône, un nom, la valeur choisie, ⌃⌄. Un toucher ouvre le
 * menu des choix, coché sur le choix du moment ; un second le referme.
 *
 * Les réglages s'étaient repliés en lignes qui se dépliaient sur place : il
 * fallait ouvrir chaque ligne pour savoir ce qu'elle cachait, et la page
 * changeait de hauteur sous le doigt. Ici, la page ne bouge pas : le menu passe
 * par-dessus, et une ligne ne dit que ce qu'il faut pour choisir.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

/** Une carte de réglages, sous son titre de famille. */
export function PrefsCard({ title, children, foot = null }) {
  return (
    <section className="prefs" aria-label={title}>
      {title && <h3 className="acct__label">{title}</h3>}
      <div className="prefs__card">{children}</div>
      {foot && <p className="prefs__foot">{foot}</p>}
    </section>
  )
}

/** La tête d'une ligne : l'icône, le nom et, en dessous, une précision. */
function Head({ icon, label, sub }) {
  return (
    <>
      {icon && <Icon name={icon} size={19} className="prow__icon" />}
      <span className="prow__text">
        <b>{label}</b>
        {sub && <em>{sub}</em>}
      </span>
    </>
  )
}

/**
 * Un choix parmi quelques-uns, en menu. `options` : `[{ key, label }]`. Le
 * menu se pose sur la ligne elle-même, comme ceux d'iOS, et s'ouvre vers le
 * haut quand la ligne est trop bas sur l'écran.
 */
export function PickRow({ icon, label, sub, value, options, onChange, shown = null }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const row = useRef(null)
  const current = options.find((o) => o.key === value)

  useLayoutEffect(() => {
    if (!open || !row.current) return
    const box = row.current.getBoundingClientRect()
    // 50 px par choix, la barre d'onglets en dessous.
    setUp(box.top + options.length * 50 + 24 > (window.innerHeight || 800) - 90)
  }, [open])

  return (
    <div className={`prow prow--pick ${open ? 'prow--open' : ''}`} ref={row}>
      <button className="prow__btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Head icon={icon} label={label} sub={sub} />
        <span className="prow__value">{shown ?? current?.label ?? ''}</span>
        <Icon name="updown" size={15} className="prow__updown" />
      </button>
      {open && (
        <>
          <div className="pop__scrim" onClick={() => setOpen(false)} />
          <div className={`pop ${up ? 'pop--up' : ''}`} role="listbox" aria-label={label}>
            {options.map((o) => (
              <button
                key={String(o.key)}
                role="option"
                aria-selected={o.key === value}
                className="pop__opt"
                onClick={() => {
                  setOpen(false)
                  if (o.key !== value) onChange(o.key)
                }}
              >
                <Icon name="check" size={16} className="pop__check" />
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Un réglage qui s'allume ou s'éteint. */
export function ToggleRow({ icon, label, sub, on, onChange, disabled = false }) {
  return (
    <div className="prow">
      <button
        className="prow__btn"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
      >
        <Head icon={icon} label={label} sub={sub} />
        <span className={`switch ${on ? 'switch--on' : ''}`} aria-hidden="true">
          <i />
        </span>
      </button>
    </div>
  )
}

/** Une ligne qui ouvre autre chose : une feuille, une page. */
export function LinkRow({ icon, label, sub, value, onClick }) {
  return (
    <div className="prow">
      <button className="prow__btn" onClick={onClick}>
        <Head icon={icon} label={label} sub={sub} />
        {value && <span className="prow__value">{value}</span>}
        <Icon name="chevronRight" size={16} className="prow__updown" />
      </button>
    </div>
  )
}
