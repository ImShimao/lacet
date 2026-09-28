/**
 * Jeu d'icônes de l'application.
 *
 * Des tracés SVG plutôt que des emojis : un emoji change de dessin selon le
 * système, ne s'aligne pas sur la grille typographique et ne prend pas la
 * couleur du texte. Ici tout hérite de `currentColor`, s'aligne au pixel et
 * reste identique partout.
 *
 * Dessin uniforme : grille 24, trait de 1,75, extrémités et jonctions rondes.
 */

const PATHS = {
  // --- activités ---------------------------------------------------------
  // Dessin repris de Tabler Icons (licence MIT) : l'ancien coureur, tracé à la
  // main, se lisait mal — bras rejeté en arrière, tête minuscule — alors qu'il
  // est l'icône la plus vue de l'app (pastille, onglet, filtres).
  run: (
    <>
      <circle cx="13" cy="4" r="1.3" />
      <path d="M4 17l5 1 .75-1.5" />
      <path d="M15 21v-4l-4-3 1-6" />
      <path d="M7 12V9l5-1 3 3 3 1" />
    </>
  ),
  bike: (
    <>
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <circle cx="15" cy="5" r="1.3" />
      <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
    </>
  ),

  // --- terrains ----------------------------------------------------------
  road: (
    <>
      <path d="M4.5 21 8 3" />
      <path d="M19.5 21 16 3" />
      <path d="M12 5.5v2.5M12 11v2.5M12 16.5V19" />
    </>
  ),
  forest: (
    <>
      <path d="M12 2.5 7.6 10h2.6L6.2 16.2h11.6L13.8 10h2.6z" />
      <path d="M12 16.2V21.5" />
    </>
  ),
  mountain: <path d="m8 3.5 4 8 3.2-3.6L21.5 20.5h-19z" />,

  // --- carte -------------------------------------------------------------
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  navigation: <path d="m3.5 11 17.5-8-8 17.5-1.9-7.6z" />,

  // --- explications ------------------------------------------------------
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // Trois profils de relief, lisibles d'un coup d'œil : plat, ondulé, en dents.
  flat: (
    <>
      <path d="M3 14.5h18" />
      <path d="M3 18.5h18" opacity="0.4" />
    </>
  ),
  rolling: (
    <>
      <path d="M3 15c2.5 0 3.5-4 6-4s3.5 4 6 4 3.5-3 6-3" />
      <path d="M3 18.5h18" opacity="0.4" />
    </>
  ),
  hilly: (
    <>
      <path d="m3 16 5-9 3.5 5 3-4 6.5 8" />
      <path d="M3 18.5h18" opacity="0.4" />
    </>
  ),
  shield: <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  pin: (
    <>
      <path d="M20 10.2c0 5.8-8 11.8-8 11.8s-8-6-8-11.8a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="2.8" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2.5 9.5 5-9.5 5-9.5-5z" />
      <path d="m2.5 12.5 9.5 5 9.5-5" />
      <path d="m2.5 17 9.5 5 9.5-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.2-4.2" />
    </>
  ),

  // --- actions -----------------------------------------------------------
  sliders: (
    <>
      <path d="M3.5 7.5h9M18.5 7.5h2M3.5 16.5h3M12.5 16.5h8" />
      <circle cx="15.5" cy="7.5" r="2.6" />
      <circle cx="9.5" cy="16.5" r="2.6" />
    </>
  ),
  heart: (
    <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5C2 10.8 3.5 12.5 5 14l7 7z" />
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10.5 5 5 5-5" />
      <path d="M4 20.5h16" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4" />
      <path d="M20.5 4v5.5H15" />
    </>
  ),
  play: <path d="M6.5 4.2 19 12 6.5 19.8z" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  check: <path d="m5 12.6 4.7 4.6L19 6.8" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronUp: <path d="m6.5 14.5 5.5-5.5 5.5 5.5" />,

  // --- navigation --------------------------------------------------------
  routes: (
    <>
      <circle cx="6" cy="19" r="2.8" />
      <circle cx="18" cy="5" r="2.8" />
      <path d="M8.8 19h8.4a3.4 3.4 0 0 0 0-6.8H6.8a3.4 3.4 0 0 1 0-6.8h8.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  // Un escalier vu de profil : trois marches qui montent vers la droite. Le
  // même dessin sert au filtre qui les évite et à l'explication.
  stairs: (
    <>
      <path d="M3 20h5v-4h5v-4h5V8h3" />
      <path d="M8 20v-4M13 16v-4M18 12V8" />
    </>
  ),
  // Le cône de chantier. Ses deux bandes et son socle large sont ce qui le
  // distingue du triangle de danger, à côté duquel il est affiché : sans elles,
  // les deux se ressemblaient trop pour qu'on les distingue en courant.
  cone: (
    <>
      <path d="M12 3.5 17 18.5H7z" />
      <path d="M9.9 12h4.2" />
      <path d="M8.8 15.2h6.4" />
      <path d="M3.5 21h17" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5 22 20.5H2z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.6" r="1" fill="currentColor" stroke="none" />
    </>
  ),

  // --- guidage -----------------------------------------------------------
  // Les flèches de manœuvre partent du bas de la grille : c'est la position du
  // coureur. Le trait monte, puis tourne — on lit le geste, pas un symbole.
  turnLeft: (
    <>
      <path d="M18 21v-8a4 4 0 0 0-4-4H7" />
      <path d="m10.5 5.5-4 3.5 4 3.5" />
    </>
  ),
  turnRight: (
    <>
      <path d="M6 21v-8a4 4 0 0 1 4-4h7" />
      <path d="m13.5 5.5 4 3.5-4 3.5" />
    </>
  ),
  straight: (
    <>
      <path d="M12 21V5" />
      <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V3.5" />
      <path d="M6 4.5h12l-2.6 4 2.6 4H6" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
      <path d="M16 9a4.2 4.2 0 0 1 0 6" />
      <path d="M18.8 6.2a8 8 0 0 1 0 11.6" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  sos: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5" />
      <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V6M17 20v-9" />
    </>
  ),
  // Demi-tour : on remonte, on tourne, on redescend de l'autre côté.
  uturn: (
    <>
      <path d="M17 20V10a5 5 0 0 0-10 0v8" />
      <path d="m4 15 3 3 3-3" />
    </>
  ),
  // Le point de départ : un repère et une croix pour « poser ici ».
  pinPlus: (
    <>
      <path d="M19 10.2c0 5.4-7 11.3-7 11.3s-7-5.9-7-11.3a7 7 0 0 1 14 0z" />
      <path d="M12 7.2v6M9 10.2h6" />
    </>
  ),
  // Tout le parcours d'un coup d'œil : quatre coins qui s'écartent.
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
}

export default function Icon({ name, size = 20, className = '', strokeWidth = 1.75 }) {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  )
}

/** Icônes pleines, pour les cas où le trait manque de présence (favori actif). */
export function SolidIcon({ name, size = 20, className = '' }) {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  )
}
