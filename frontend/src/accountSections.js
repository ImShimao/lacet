/**
 * Les pages de « Mon compte », à part : l'en-tête de l'app s'en sert avant que
 * l'écran lui-même soit chargé (`App.jsx`, import à la demande).
 */
import { t } from './i18n'

// Huit pages de réglages plutôt que quatre fourre-tout : « Guidage et voix »
// mêlait voix, séance fractionnée et comportement en course, « Parcours »
// cachait les raccourcis de l'accueil sous trois cartes d'itinéraire. Le
// groupe donne l'intitulé sous lequel la ligne se range dans le sommaire.
export const SECTIONS = [
  { key: 'profile', group: null, icon: 'user', title: 'Profil' },
  { key: 'search', group: 'Recherche', icon: 'routes', title: 'Itinéraire' },
  { key: 'home', group: 'Recherche', icon: 'sliders', title: 'Accueil et filtres' },
  { key: 'voice', group: 'Course', icon: 'volume', title: 'Voix' },
  { key: 'run', group: 'Course', icon: 'navigation', title: 'Pendant la sortie' },
  { key: 'workout', group: 'Course', icon: 'flame', title: 'Séance fractionnée' },
  { key: 'safety', group: 'Sécurité', icon: 'sos', title: 'Contact d\'urgence' },
  { key: 'zones', group: 'Sécurité', icon: 'zone', title: 'Zones et signalements' },
  { key: 'appearance', group: 'Affichage', icon: 'appearance', title: 'Apparence' },
  { key: 'storage', group: 'Données', icon: 'layers', title: 'Stockage' },
  { key: 'backup', group: 'Données', icon: 'archive', title: 'Sauvegarde' },
  { key: 'about', group: 'Infos', icon: 'info', title: 'À propos' },
]

// Les intitulés de l'onglet « Paramètres », dans l'ordre.
export const SETTINGS_GROUPS = ['Recherche', 'Course', 'Sécurité', 'Affichage']

/** Le titre d'une page, pour l'en-tête de l'app. */
export const sectionTitle = (key) => t(SECTIONS.find((s) => s.key === key)?.title ?? 'Mon compte')
