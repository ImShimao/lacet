/**
 * La première ouverture : trois pages, une seule fois. Elles disent ce que fait
 * l'app (des boucles qui reviennent à la porte), ce que veut dire la note A, B
 * ou C — avec les vrais seuils du moteur, ceux de `docs/securite.md` —, et que
 * la voix guide écran verrouillé. On peut revenir en arrière ou tout passer.
 * Les autorisations (GPS, voix) ne sont pas demandées ici : elles viennent au
 * premier usage, là où l'on comprend pourquoi.
 */

import { useEffect, useState } from 'react'

import Icon from './Icon.jsx'
import { t } from './i18n'

const KEY = 'lacet.accueil'
// Le lancement animé dure 1,5 s puis s'efface en 0,35 s (`Launch.jsx`).
const SHOW_AFTER_MS = 1900

const PAGES = [
  {
    art: 'loop',
    title: 'Des boucles qui reviennent à ta porte',
    text: 'Indique une distance ou une durée : Lacet trace des parcours qui partent de chez toi et y reviennent.',
  },
  {
    art: 'grades',
    title: 'Chaque boucle est notée',
    text: 'La note ne juge que la sécurité du tracé : ni sa beauté, ni sa longueur, ni son dénivelé.',
  },
  {
    art: 'voice',
    title: 'Guidé à la voix',
    text: 'Pendant la sortie, chaque virage est annoncé à voix haute, même écran verrouillé. Le téléphone peut rester en poche.',
  },
]

// Les seuils du moteur (`safety/gate`), dits sans jargon.
const GRADES = [
  ['A', 'Au plus 1 % du parcours au contact du trafic, et aucune traversée non protégée.'],
  ['B', 'Au plus 3 % du parcours au contact du trafic.'],
  ['C', 'Plus exposée. Proposée seulement en mode Standard, jamais en mode Sûr.'],
]

function seen() {
  try {
    return localStorage.getItem(KEY) === 'oui'
  } catch {
    // Sans stockage, l'accueil revient à chaque ouverture : rien ne casse.
    return false
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, 'oui')
  } catch {
    // Même réponse : au pire, il revient à la prochaine ouverture.
  }
}

function LoopArt() {
  return (
    <svg className="welcome__loop" viewBox="0 0 200 160" aria-hidden="true">
      {/* Quelques rues en fond : la boucle se lit comme sur la carte. */}
      <path
        className="welcome__streets"
        d="M0 112 L200 100 M0 58 L200 44 M70 0 L54 160 M132 0 L150 160 M0 150 L90 0"
      />
      <path
        className="welcome__trace"
        pathLength="1"
        d="M100 130 C96 118 88 112 74 110 C52 106 40 90 44 70 C48 50 66 44 80 40 C96 36 102 22 122 24 C146 26 162 44 158 66 C155 84 140 88 136 100 C132 112 112 112 104 120 C101 123 100 127 100 130"
      />
      <circle className="welcome__home" cx="100" cy="128" r="9" />
    </svg>
  )
}

function GradesArt() {
  return (
    <div className="welcome__badges" aria-hidden="true">
      {GRADES.map(([g]) => (
        <span key={g} className={`grade grade--${g}`}>
          {g}
        </span>
      ))}
    </div>
  )
}

// Le détail des seuils, sous le texte : on lit d'abord ce qu'est la note.
function GradeList() {
  return (
    <ul className="welcome__grades">
      {GRADES.map(([g, text]) => (
        <li key={g}>
          <span className={`grade grade--${g}`}>{g}</span>
          <span>{t(text)}</span>
        </li>
      ))}
    </ul>
  )
}

function VoiceArt() {
  return (
    <div className="welcome__voice" aria-hidden="true">
      <div className="welcome__bubble">
        <Icon name="volume" size={18} />
        <span>{t('Dans 150 m, à droite')}</span>
      </div>
      <div className="welcome__lock">
        <Icon name="lock" size={22} />
      </div>
    </div>
  )
}

const ART = { loop: LoopArt, grades: GradesArt, voice: VoiceArt }

export default function Welcome() {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState('fwd')
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(seen)

  // Pas pendant le lancement animé : l'accueil arrive une fois la marque partie.
  useEffect(() => {
    if (done) return undefined
    const timer = setTimeout(() => setOpen(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [done])

  if (done || !open) return null

  const page = PAGES[step]
  const Art = ART[page.art]
  const last = step === PAGES.length - 1
  const finish = () => {
    remember()
    setDone(true)
  }
  const go = (next) => {
    setDir(next > step ? 'fwd' : 'back')
    setStep(next)
  }

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <header className="welcome__bar">
        {/* Caché plutôt que retiré sur la première page : la barre ne bouge pas. */}
        <button
          className="welcome__back"
          onClick={() => go(step - 1)}
          style={{ visibility: step > 0 ? 'visible' : 'hidden' }}
        >
          <span aria-hidden="true">‹</span>
          {t('Retour')}
        </button>
        <button className="welcome__skip" onClick={finish}>
          {t('Passer')}
        </button>
      </header>

      {/* La clé rejoue l'entrée à chaque page, dans le sens du geste. */}
      <main key={step} className={`welcome__page welcome__page--${dir}`}>
        <div className="welcome__art">
          <Art />
        </div>
        <h2 id="welcome-title" className="welcome__title">
          {t(page.title)}
        </h2>
        <p className="welcome__text">{t(page.text)}</p>
        {page.art === 'grades' && <GradeList />}
        {page.art === 'grades' && (
          <p className="welcome__note">
            {t('« Au contact du trafic » : une route à 80 km/h ou plus, sans trottoir ni accotement. Autoroutes, voies rapides et tunnels sans trottoir sont écartés d\'office.')}
          </p>
        )}
      </main>

      <footer className="welcome__foot">
        <div className="welcome__dots" aria-label={t('Page {n} sur {total}', { n: step + 1, total: PAGES.length })}>
          {PAGES.map((p, i) => (
            <span key={p.art} className={`welcome__dot ${i === step ? 'welcome__dot--on' : ''}`} />
          ))}
        </div>
        <button className="btn btn--primary welcome__next" onClick={last ? finish : () => go(step + 1)}>
          {last ? t('Commencer') : t('Continuer')}
        </button>
      </footer>
    </div>
  )
}
