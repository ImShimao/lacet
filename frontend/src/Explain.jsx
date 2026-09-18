import { useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import useModal from './useModal'
import { explain } from './explain'

/**
 * Le petit « i » à côté d'un réglage, et la fiche qu'il ouvre.
 *
 * Un réglage qu'on ne comprend pas, on le laisse sur sa valeur par défaut — ou
 * on le règle au hasard, et la boucle proposée surprend sans qu'on sache
 * pourquoi. La fiche dit, option par option, ce que le moteur en fait.
 */
export function InfoButton({ topic, sport }) {
  const [open, setOpen] = useState(false)
  const content = explain(topic, sport)
  if (!content) return null

  return (
    <>
      <button
        type="button"
        className="info-btn"
        onClick={() => setOpen(true)}
        aria-label={`Explications : ${content.title}`}
        aria-haspopup="dialog"
      >
        <Icon name="info" size={17} />
      </button>
      {open && <InfoSheet content={content} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * La fiche elle-même, posée par-dessus tout le reste.
 *
 * Rendue dans `#root` plutôt qu'à l'intérieur du panneau qui l'appelle : un
 * panneau défilant la couperait, et `#root` est aussi ce qui pivote quand le
 * téléphone se couche — la fiche pivote donc avec l'app.
 *
 * Les clics s'arrêtent à elle : React fait remonter les événements d'un
 * portail jusqu'à son parent, et toucher le fond de la fiche fermait aussi la
 * fenêtre des filtres en dessous.
 */
function InfoSheet({ content, onClose }) {
  const panel = useModal(onClose)
  const titleId = `info-${content.title.replace(/\W+/g, '-')}`

  return createPortal(
    <div
      className="infosheet"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div
        className="infosheet__panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{content.title}</h3>
        {content.intro && <p className="infosheet__intro">{content.intro}</p>}
        <ul className="infosheet__list">
          {content.items.map((item) => (
            <li key={item.label}>
              <span className="infosheet__key">
                <Icon name={item.icon} size={26} />
                <b>{item.label}</b>
              </span>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
        <button className="btn btn--primary" onClick={onClose}>
          J'ai compris
        </button>
      </div>
    </div>,
    document.getElementById('root') ?? document.body,
  )
}
