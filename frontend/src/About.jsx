import Icon from './Icon.jsx'
import Logo from './Logo.jsx'
import { t } from './i18n'

/**
 * « À propos » : la version, puis les pages légales qu'Apple et le RGPD
 * demandent, dans l'app même — sans compte ni serveur, il n'y a rien d'autre à
 * consulter ailleurs.
 *
 * Une ligne par engagement plutôt qu'un paragraphe : les conditions et la
 * confidentialité tenaient en quatre blocs de gris serré, qu'on ne lisait pas.
 * L'essentiel (la note n'est pas une garantie, rien ne quitte le téléphone) se
 * lit maintenant d'un coup d'œil, le détail juste dessous.
 */
export default function About({ version = null, diagnostic = null }) {
  return (
    <>
      <div className="about__head">
        <span className="about__mark">
          <Logo size={40} />
        </span>
        <div className="about__id">
          <b>Lacet</b>
          {version}
        </div>
      </div>

      <h3 className="acct__label">{t('Conditions d\'utilisation')}</h3>
      <div className="about__callout">
        <Icon name="shield" size={20} />
        <p>
          <b>{t('La note A, B ou C est une estimation, pas une garantie.')}</b>{' '}
          {t('Regarde la route, respecte le Code de la route et reste seul juge de ton parcours.')}
        </p>
      </div>
      <ul className="menu about__list">
        <Point icon="layers" title={t('Des données ouvertes, parfois incomplètes')}>
          {t('OpenStreetMap peut manquer un trottoir, un chantier ou une rue mal éclairée.')}
        </Point>
        <Point icon="routes" title={t('Fourni tel quel')}>
          {t('Boucles, distances, dénivelé et guidage peuvent être inexacts.')}
        </Point>
        <Point icon="sos" title={t('Le SOS ne remplace pas le 112')}>
          {t('Il prépare un SMS : il n\'appelle pas les secours.')}
        </Point>
      </ul>

      <h3 className="acct__label">{t('Confidentialité')}</h3>
      <div className="about__pillars">
        <Pillar icon="user" label={t('Aucun compte')} />
        <Pillar icon="chart" label={t('Aucune mesure d\'usage')} />
        <Pillar icon="ban" label={t('Aucune publicité')} />
      </div>
      <ul className="menu about__list">
        <Point icon="lock" title={t('Reste sur cet appareil')}>
          {t('Favoris, sorties, réglages et contact d\'urgence.')}
        </Point>
        <Point icon="navigation" title={t('Part sur le réseau, sans rien qui t\'identifie')}>
          {t('La zone autour du départ (rues, altitudes, vent, fond de carte) et le lieu cherché par son nom.')}
        </Point>
        <Point icon="share" title={t('Seulement si tu le décides')}>
          {t('Une sortie quitte le téléphone quand tu l\'exportes ou la partages.')}
        </Point>
        <Point icon="archive" title={t('Tout effacer')}>
          {t('Dans Sauvegarde, supprime tout ce que l\'app a gardé.')}
        </Point>
      </ul>
      <p className="muted small about__foot">{t('Une question ? La page du projet sur GitHub.')}</p>

      <h3 className="acct__label">{t('Sources')}</h3>
      <dl className="menu about__sources">
        {SOURCES.map(([what, who]) => (
          <div key={what}>
            <dt>{t(what)}</dt>
            <dd>{t(who)}</dd>
          </div>
        ))}
      </dl>
      {/* Le temps du dernier calcul : utile quand une recherche traîne, mais
          technique — en pied de page, pas sous le nom de l'app. */}
      <div className="about__diag">{diagnostic}</div>
    </>
  )
}

/** Les données et services dont l'app se sert, avec leur licence quand elle l'exige. */
const SOURCES = [
  ['Rues et chemins', '© contributeurs OpenStreetMap (ODbL)'],
  ['Fonds de carte', '© OpenFreeMap, © OpenMapTiles, © OpenTopoMap (CC-BY-SA), © Mapbox'],
  ['Altitudes', 'IGN RGE ALTI ; Mapzen / Copernicus EU-DEM (hors ligne) et Valhalla (FOSSGIS) hors de France'],
  ['Recherche de lieux', 'Photon (Komoot) et Nominatim'],
  ['Vent', 'MET Norway (CC BY 4.0)'],
]

/** Un engagement : son icône, une phrase qui le dit, une ligne de détail. */
function Point({ icon, title, children }) {
  return (
    <li className="menu__row about__point">
      <span className="menu__icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="menu__text">
        <b>{title}</b>
        <em>{children}</em>
      </span>
    </li>
  )
}

function Pillar({ icon, label }) {
  return (
    <div className="about__pillar">
      <Icon name={icon} size={20} />
      <span>{label}</span>
    </div>
  )
}
