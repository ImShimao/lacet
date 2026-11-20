/**
 * La marque Lacet : une boucle à la forme libre d'un vrai parcours, et son
 * départ. Le même tracé que l'icône et l'écran de lancement
 * (`scripts/make-icons.py`, `LOOP`) : l'ouverture de l'app reprend exactement
 * ce que l'écran de lancement montrait.
 */

export const LOOP =
  'M21 46C10 34 14 15 28 12C41 9 55 18 51 31C48 41 41 40 39 47C37 55 27 55 21 46'

export default function Logo({ size = 40, className = '' }) {
  return (
    <svg className={`logo ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path className="logo__loop" d={LOOP} pathLength="1" />
      <circle className="logo__ring" cx="21" cy="46" r="8.6" />
      <circle className="logo__dot" cx="21" cy="46" r="6.2" />
    </svg>
  )
}
