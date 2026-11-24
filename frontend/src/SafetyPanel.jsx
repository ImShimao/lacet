import { percent } from './format'

import { t } from './i18n'
import { engineText } from './stepText'
/**
 * Sur quoi repose la note. C'est l'écran qui porte la promesse du produit :
 * il ne suffit pas d'afficher « A », il faut montrer sur quoi elle repose.
 *
 * Deux sections, comme les cartes de Roovr : « Sécurité », quatre chiffres en
 * tuiles qu'on lit d'un coup d'œil, et « Surfaces », la barre des revêtements.
 * Ce qu'expliquent ces chiffres (`open`) se déplie sous les tuiles : le
 * tableau qui les détaillait d'emblée faisait une page de texte avant le
 * moindre graphique.
 */
export default function SafetyPanel({ safety, surfaces, segments = [], distance, sport = 'run', open = true }) {
  // Les rues calmes dont le trottoir manque sur la carte mais est probable : en
  // ville, à 50 km/h ou moins (`separation` dans `engine/safety.js`). Sans
  // elles, une boucle courue entièrement sur trottoir affichait « 51 % »
  // et rien d'autre, comme si l'autre moitié était sur la chaussée.
  const probable =
    sport === 'bike' || !distance
      ? 0
      : segments.filter((s) => s.inferred && s.separation === 1.5).reduce((m, s) => m + s.length_m, 0) / distance

  const rows = [
    {
      // Ce qui protège un cycliste n'est pas ce qui protège un coureur : le
      // trottoir ne lui sert à rien, la bande cyclable si.
      label: sport === 'bike' ? t('Aménagement cyclable') : t('Trottoir ou voie propre'),
      value: percent(safety.protected_share),
      // Volontairement sans couleur : c'est un renseignement, pas un verdict.
      // Un parcours à 46 % de voie dédiée mais zéro mètre d'exposition est un
      // bon parcours ; le peindre en rouge donnerait une fausse alerte.
      tone: null,
      // Ce qui n'y est pas n'est pas pour autant exposé : une rue calme dont le
      // trottoir manque sur la carte en est absente, et se lisait comme le reste
      // du parcours livré aux voitures.
      hint:
        sport === 'bike'
          ? t('piste, bande ou voie sans voitures, connue de la carte')
          : t('trottoir ou chemin connus de la carte — une rue calme au trottoir non noté n’y compte pas'),
    },
    ...(probable >= 0.01
      ? [
          {
            label: t('Rue calme, trottoir probable'),
            value: percent(probable),
            tone: null,
            hint: t('en ville, à 50 km/h ou moins : non noté sur la carte, mais presque toujours là'),
          },
        ]
      : []),
    {
      label: t('Exposé au trafic rapide'),
      hint:
        safety.longest_exposed_m > 0
          ? t('dont {v1} m d\'un seul tenant', { v1: Math.round(safety.longest_exposed_m) })
          : t('route à 80 km/h ou plus, sans trottoir ni accotement'),
      value: `${Math.round(safety.exposed_m)} m`,
      tone: safety.exposed_m === 0 ? 'good' : safety.exposed_share <= 0.03 ? 'warn' : 'bad',
    },
    {
      label: t('Traversées non protégées'),
      value: String(safety.unprotected_crossings),
      // Les ronds blancs cerclés sur la carte : sans cette phrase, rien ne disait
      // ce qu'ils étaient, et on les prenait pour des étapes.
      hint:
        [
          safety.unprotected_crossings > 0 ? t('ronds cerclés de rouge sur la carte') : null,
          safety.protected_crossings > 0
            ? t('{protected_crossings} protégée(s), cerclées de jaune', { protected_crossings: safety.protected_crossings })
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      tone: safety.unprotected_crossings === 0 ? 'good' : 'warn',
    },
  ]

  if (safety.unlit_m !== null && safety.unlit_m !== undefined) {
    rows.push({
      label: t('Non éclairé'),
      value: `${Math.round(safety.unlit_m)} m`,
      tone: safety.unlit_m === 0 ? 'good' : 'warn',
    })
  }

  const surfaceRows = [
    ['paved', t('Bitume'), surfaces.paved_m],
    ['gravel', t('Chemin'), surfaces.gravel_m],
    ['trail', t('Sentier'), surfaces.trail_m],
    ['unknown', t('Indéterminé'), surfaces.unknown_m],
  ].filter(([, , metres]) => metres > 1)

  return (
    <>
      <section className="block safety">
        <div className="block__head">
          <span className="label">{t('Sécurité')}</span>
        </div>
        <div className="safety__tiles">
          {rows.map((row) => (
            <div key={row.label} className="safety__tile">
              <b className={`safety__value ${row.tone ? `safety__value--${row.tone}` : ''}`}>{row.value}</b>
              <span>{row.label}</span>
            </div>
          ))}
        </div>
        {open && (
          <div className="safety__more">
            {rows
              .filter((row) => row.hint)
              .map((row) => (
                <p key={row.label}>
                  <b>{row.label}</b> : {row.hint}.
                </p>
              ))}
            {safety.notes.map((note, i) => (
              <p key={i} className="safety__note">
                {engineText(note)}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="block">
        <div className="block__head">
          <span className="label">{t('Surfaces')}</span>
        </div>
        <div className="bar" role="img" aria-label={t('Répartition des revêtements')}>
          {surfaceRows.map(([key, , metres]) => (
            <span key={key} className={`s--${key}`} style={{ width: `${(metres / distance) * 100}%` }} />
          ))}
        </div>
        <div className="bar__legend">
          {surfaceRows.map(([key, label, metres]) => (
            <span key={key} className="bar__key">
              <i className={`s--${key}`} />
              {label} {percent(metres / distance)}
            </span>
          ))}
        </div>
      </section>
    </>
  )
}
