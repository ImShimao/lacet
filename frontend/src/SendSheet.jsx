/**
 * « Envoyer cette boucle » : où l'envoyer, et comment l'y faire entrer.
 *
 * Le fichier est le même GPX partout ; ce qui manquait, c'était le chemin de
 * chaque app. Garmin Connect, COROS et Suunto le prennent par le partage d'iOS ;
 * Strava et Komoot ne lisent pas le partage : il faut passer par leur site, et
 * l'écran le dit étape par étape (Roovr le fait ainsi, et c'est ce qui manquait
 * à « Partager » seul).
 *
 * **Pas de logos officiels.** Strava et Garmin n'autorisent le leur, dans une
 * autre app, qu'à travers leurs badges « Compatible with… », obtenus par leur
 * programme partenaire ; une app vendue ne prend pas ce risque sans accord écrit.
 * Une pastille à la couleur de l'app, avec son initiale, la fait reconnaître
 * sans reproduire sa marque. Quand un accord sera là, les badges officiels
 * remplaceront ces pastilles ici, et nulle part ailleurs.
 */

import { useState } from 'react'
import Icon from './Icon.jsx'
import { isNative } from './platform'

import { t } from './i18n'
const BRANDS = {
  garmin: { color: '#007CC3', letter: 'G' },
  strava: { color: '#FC4C02', letter: 'S' },
  komoot: { color: '#4F6F18', letter: 'K' },
  coros: { color: '#E4002B', letter: 'C' },
  suunto: { color: '#1A1A1A', letter: 'S' },
}

/** La pastille d'une app : son initiale en blanc, sur sa couleur. */
export function BrandBadge({ brand }) {
  const b = BRANDS[brand]
  if (!b) return null
  return (
    <span className="brand" style={{ background: b.color }} aria-hidden="true">
      <b>{b.letter}</b>
    </span>
  )
}

const DESTINATIONS = [
  { key: 'garmin', brand: 'garmin', title: 'Garmin Connect', sub: 'Choisis Connect dans le menu de partage.' },
  { key: 'coros', brand: 'coros', title: 'COROS', sub: 'Choisis COROS dans le menu de partage.' },
  { key: 'suunto', brand: 'suunto', title: 'Suunto', sub: 'Choisis Suunto dans le menu de partage.' },
  {
    key: 'strava',
    brand: 'strava',
    title: 'Strava',
    sub: 'On te guide pour la pousser sur Strava.',
    guide: {
      warning: 'Strava demande un abonnement payant pour importer un itinéraire.',
      url: 'https://www.strava.com/athlete/routes',
      steps: [
        ['Enregistre le GPX', 'Dans le menu de partage, « Enregistrer dans Fichiers ».'],
        ['Ouvre Strava dans Safari', 'Ta session y est active si tu es déjà connecté.'],
        ['Importe le fichier', 'Mes itinéraires › Importer un GPX › le fichier de Lacet › Enregistrer.'],
        ['Lance ta boucle', "Dans l'app Strava : Enregistrer › Itinéraires › la tienne."],
      ],
    },
  },
  {
    key: 'komoot',
    brand: 'komoot',
    title: 'Komoot',
    sub: 'On te guide pour la pousser sur Komoot.',
    guide: {
      url: 'https://www.komoot.com/upload',
      steps: [
        ['Enregistre le GPX', 'Dans le menu de partage, « Enregistrer dans Fichiers ».'],
        ['Ouvre Komoot', 'La page d’import du site, dans Safari.'],
        ['Importe le fichier', "Choisis le fichier de Lacet : il devient un itinéraire, retrouvé dans l'app."],
      ],
    },
  },
  { key: 'file', icon: 'download', title: 'Fichier GPX', sub: 'Pour toute autre montre ou app.' },
]

const openSite = async (url) => {
  if (isNative()) return (await import('./native')).openExternal(url)
  window.open(url, '_blank', 'noopener')
}

export default function SendSheet({ onSend, busy = false, onClose }) {
  const [guide, setGuide] = useState(null)

  if (guide) {
    const { title, brand, guide: g } = guide
    return (
      <section className="sendsheet" aria-label={t('Envoyer sur {title}', { title })}>
        <header className="sendsheet__head">
          <span>
            <em>{title}</em>
            <b>{t('Pousser cette boucle sur {title}', { title })}</b>
          </span>
          <button className="sendsheet__close" onClick={() => setGuide(null)} aria-label={t('Revenir')}>
            <Icon name="close" size={16} />
          </button>
        </header>
        {g.warning && (
          <p className="sendsheet__warn">
            <Icon name="warning" size={15} />
            {t(g.warning)}
          </p>
        )}
        <ol className="sendsheet__steps">
          {g.steps.map(([head, text], i) => (
            <li key={head}>
              <i style={{ background: BRANDS[brand].color }}>{i + 1}</i>
              <span>
                <b>{t(head)}</b>
                <em>{t(text)}</em>
              </span>
            </li>
          ))}
        </ol>
        <div className="sendsheet__actions">
          <button className="btn" onClick={onSend} disabled={busy}>
            <Icon name="download" size={16} />{t('Enregistrer le GPX')}</button>
          <button className="btn btn--primary sendsheet__go" style={{ background: BRANDS[brand].color }} onClick={() => openSite(g.url)}>{t('Ouvrir {title}', { title })}</button>
        </div>
      </section>
    )
  }

  return (
    <section className="sendsheet" aria-label={t('Envoyer cette boucle')}>
      <header className="sendsheet__head">
        <span>
          <em>{t('Partage')}</em>
          <b>{t('Envoyer cette boucle')}</b>
        </span>
        {onClose && (
          <button className="sendsheet__close" onClick={onClose} aria-label={t('Fermer')}>
            <Icon name="close" size={16} />
          </button>
        )}
      </header>
      <div className="sendsheet__list">
        {DESTINATIONS.map((d) => (
          <button
            key={d.key}
            className="sendsheet__row"
            onClick={() => (d.guide ? setGuide(d) : onSend())}
            disabled={busy && !d.guide}
          >
            {d.brand ? (
              <BrandBadge brand={d.brand} />
            ) : (
              <span className="brand brand--app" aria-hidden="true">
                <Icon name={d.icon} size={18} />
              </span>
            )}
            <span className="sendsheet__text">
              <b>{t(d.title)}</b>
              <em>{t(d.sub)}</em>
            </span>
            <Icon name="chevronRight" size={16} />
          </button>
        ))}
      </div>
    </section>
  )
}
