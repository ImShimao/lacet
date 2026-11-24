/**
 * D'où vient le dénivelé d'une sortie, et ce qu'il vaut à côté du prévu.
 *
 * Mesuré au baromètre, il se compare au dénivelé annoncé. Tiré de l'altitude
 * du GPS — un iPhone qui refuse l'accès aux mouvements, ou une sortie d'avant
 * le baromètre —, il ne vaut qu'à quelques dizaines de mètres près : mieux vaut
 * le dire que laisser croire que le prévu s'est trompé.
 */
import { t } from './i18n'
export default function AscentNote({ entry }) {
  if (entry.actual_ascent_m == null) return null
  const planned = entry.free || entry.ascent_m == null ? null : Math.round(entry.ascent_m)

  if (entry.actual_ascent_source === 'baro') {
    return (
      <p className="muted small">{t('Dénivelé mesuré au baromètre du téléphone{v1}', { v1: planned != null ? t(' — {planned} m étaient prévus.', { planned }) : '.' })}</p>
    )
  }
  return (
    <p className="muted small">{t('Dénivelé tiré de l\'altitude du GPS, qui tremble de plusieurs mètres : un ordre de grandeur{v1}. Pour le mesurer au baromètre, autorise l\'accès dans Réglages › Lacet › Mouvements et forme.', { v1: planned != null ? t(', à comparer de loin aux {planned} m prévus', { planned }) : '' })}</p>
  )
}
