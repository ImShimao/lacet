// Ce que veut dire chaque réglage, en clair.
//
// « Vallonné », « Mixte », « Sûr » : des mots qu'on comprend chacun à sa façon.
// Le moteur, lui, leur donne un sens précis — un facteur de préférence, une
// cible de dénivelé par kilomètre, un plafond de portion exposée. Ces textes
// disent ce sens-là, avec ses chiffres, pour qu'on sache ce qu'on choisit.
//
// Les chiffres viennent du moteur : `engine/weights.js` (terrain),
// `engine/service.js` (dénivelé), `engine/safety.js` (sécurité, notes). S'ils
// changent là-bas, ils doivent changer ici.

const TERRAIN_RUN = {
  title: 'Types de terrain',
  items: [
    {
      icon: 'road',
      label: 'Route',
      text: "Sols durs d'abord : trottoirs, bitume, pistes. Un chemin de terre n'est pris que s'il évite un vrai détour — un sentier compte plus du double de sa longueur.",
    },
    {
      icon: 'forest',
      label: 'Mixte',
      text: 'Bitume, chemins et sentiers se valent, avec une légère préférence pour les sols souples. Le bon choix par défaut, en ville comme autour.',
    },
    {
      icon: 'mountain',
      label: 'Sentier',
      text: "Chemins et sentiers d'abord, y compris ceux des bois et des champs, que la recherche va chercher en plus. Le bitume ne sert qu'à les relier.",
    },
  ],
}

const TERRAIN_BIKE = {
  title: 'Types de terrain',
  items: [
    {
      icon: 'road',
      label: 'Route',
      text: 'Bitume et pistes cyclables. Les chemins de gravier sont évités, les sentiers presque toujours.',
    },
    {
      icon: 'forest',
      label: 'Mixte',
      text: "Bitume et chemins stabilisés se valent : pour un vélo polyvalent ou un gravel. Les sentiers étroits restent évités.",
    },
    {
      icon: 'mountain',
      label: 'VTT',
      text: 'Chemins et sentiers en priorité, bitume seulement pour les relier.',
    },
  ],
}

const RELIEF = {
  title: 'Dénivelé',
  intro:
    "Le dénivelé positif (D+) est le total des montées sur la boucle. Les boucles sont choisies pour s'approcher de la cible, pas forcées : en plaine, « Côtes » ne peut pas inventer de colline.",
  items: [
    {
      icon: 'flat',
      label: 'Plat',
      text: 'Le moins de montée possible : vers 3 m par kilomètre, soit une trentaine de mètres pour 10 km. Pour une sortie facile, une récupération, un fractionné.',
    },
    {
      icon: 'rolling',
      label: 'Vallonné',
      text: 'Un peu de relief sans chercher la côte : vers 10 m par kilomètre, une centaine de mètres pour 10 km.',
    },
    {
      icon: 'hilly',
      label: 'Côtes',
      text: 'Les montées sont recherchées : 20 m par kilomètre et plus, 200 m et au-delà pour 10 km. Pour travailler la force et le souffle.',
    },
  ],
}

// Les plafonds de `THRESHOLDS`, dans `engine/safety.js` : un vélo roule sur la
// chaussée par nature, et ses plafonds sont plus larges.
const SAFETY_LIMITS = {
  run: { safe: [3, 150], standard: 8 },
  bike: { safe: [8, 1000], standard: 20 },
}

const safety = (sport) => {
  const { safe, standard } = SAFETY_LIMITS[sport] ?? SAFETY_LIMITS.run
  return {
    title: 'Sécurité',
    intro:
      "Chaque boucle est notée A, B ou C. A : quasiment tout sur trottoir ou voie propre, et aucune traversée sans passage protégé. B : quelques mètres au contact du trafic. C : davantage. Tout vient d'OpenStreetMap — un chantier d'hier n'y est pas encore.",
    items: [
      {
        icon: 'shield',
        label: 'Sûr',
        text: `Écarte toute boucle qui longe une route rapide sans trottoir ni accotement, ou qui la traverse sans passage protégé. Au plus ${safe[0]} % du parcours au contact du trafic, jamais plus de ${safe[1]} m d'affilée.`,
      },
      {
        icon: 'warning',
        label: 'Standard',
        text: `Montre aussi les boucles plus exposées — jusqu'à ${standard} % au contact du trafic — avec le détail des portions concernées. Pour un coin que tu connais, ou quand « Sûr » ne trouve rien.`,
      },
    ],
  }
}

// Les facteurs d'`AVOID_FACTOR`, dans `engine/weights.js` : vingt-cinq fois la
// longueur. Un évitement n'interdit pas — il rend le détour presque toujours
// préférable.
const AVOID = {
  title: 'Ce qu’on évite',
  intro:
    "Un évitement multiplie par vingt-cinq la longueur ressentie du tronçon : un escalier de trente mètres en coûte sept cent cinquante, et tout détour raisonnable le bat. Ce n'est pas une interdiction — quand c'est le seul accès, la boucle passe quand même, plutôt que de ne rien proposer du tout.",
  items: [
    {
      icon: 'stairs',
      label: 'Escaliers',
      text: "Les volées de marches d'OpenStreetMap (`highway=steps`). Cent mètres de dénivelé pris dans un escalier, ce n'est pas la même sortie qu'une côte régulière — et à vélo, ils sont interdits de toute façon.",
    },
    {
      icon: 'warning',
      label: 'Grands axes',
      text: "Les voies où l'on court au contact du trafic : une route rapide sans trottoir ni accotement. Le réglage « Sécurité » écarte la boucle entière au-delà d'un seuil ; cette case, elle, écarte chaque tronçon, un par un.",
    },
    {
      icon: 'moon',
      label: 'Rues non éclairées',
      text: "Les voies explicitement données comme non éclairées (`lit=no`). Celles qui ne disent rien ne sont pas pénalisées : la moitié des rues d'un village n'ont simplement pas l'information, et les écarter viderait la carte.",
    },
  ],
}

const SPORT = {
  title: 'Activité',
  items: [
    {
      icon: 'run',
      label: 'Course',
      text: "Trottoirs, allées et chemins piétons. Les escaliers sont évités sans être interdits. Jusqu'à 60 km.",
    },
    {
      icon: 'bike',
      label: 'Vélo',
      text: "Pistes et bandes cyclables, routes calmes. Les voies réservées aux piétons sont fortement évitées. Jusqu'à 250 km.",
    },
  ],
}

/** L'explication d'un réglage, dans le vocabulaire du sport choisi. */
export function explain(topic, sport = 'run') {
  if (topic === 'terrain') return sport === 'bike' ? TERRAIN_BIKE : TERRAIN_RUN
  if (topic === 'safety') return safety(sport)
  return { relief: RELIEF, sport: SPORT, avoid: AVOID }[topic] ?? null
}
