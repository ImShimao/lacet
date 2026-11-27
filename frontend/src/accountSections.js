/**
 * Les pages de « Mon compte », à part : l'en-tête de l'app s'en sert avant que
 * l'écran lui-même soit chargé (`App.jsx`, import à la demande).
 */
import { t } from './i18n'

export const SECTIONS = [
  { key: 'profile', group: null, icon: 'user', title: 'Profil' },
  { key: 'search', group: 'Paramètres', icon: 'routes', title: 'Parcours' },
  { key: 'run', group: 'Paramètres', icon: 'volume', title: 'Guidage et voix', tone: 'info' },
  { key: 'safety', group: 'Paramètres', icon: 'sos', title: 'Sécurité', tone: 'risk' },
  { key: 'appearance', group: 'Paramètres', icon: 'appearance', title: 'Apparence', tone: 'caution' },
  { key: 'storage', group: 'Données', icon: 'layers', title: 'Stockage', tone: 'safe' },
  { key: 'backup', group: 'Données', icon: 'archive', title: 'Sauvegarde', tone: 'trail' },
  { key: 'about', group: 'Infos', icon: 'info', title: 'À propos' },
]

/** Le titre d'une page, pour l'en-tête de l'app. */
export const sectionTitle = (key) => t(SECTIONS.find((s) => s.key === key)?.title ?? 'Mon compte')

