/**
 * Les pages de « Mon compte », à part : l'en-tête de l'app s'en sert avant que
 * l'écran lui-même soit chargé (`App.jsx`, import à la demande).
 */
import { t } from './i18n'

export const SECTIONS = [
  { key: 'profile', group: null, icon: 'user', title: 'Profil' },
  { key: 'search', group: 'Paramètres', icon: 'routes', title: 'Parcours' },
  { key: 'run', group: 'Paramètres', icon: 'volume', title: 'Guidage et voix' },
  { key: 'safety', group: 'Paramètres', icon: 'sos', title: 'Sécurité' },
  { key: 'appearance', group: 'Paramètres', icon: 'appearance', title: 'Apparence' },
  { key: 'storage', group: 'Données', icon: 'layers', title: 'Stockage' },
  { key: 'backup', group: 'Données', icon: 'archive', title: 'Sauvegarde' },
  { key: 'about', group: 'Infos', icon: 'info', title: 'À propos' },
]

/** Le titre d'une page, pour l'en-tête de l'app. */
export const sectionTitle = (key) => t(SECTIONS.find((s) => s.key === key)?.title ?? 'Mon compte')

