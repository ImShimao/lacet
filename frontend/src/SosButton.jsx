import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { duration, km } from './format'
import { load, save } from './storage'
import useModal from './useModal'

// Appui long, en millisecondes, avant que le SOS ne s'arme. Un bouton d'alerte
// posé à côté de « Terminer », sur un écran qu'on touche en courant, part tout
// seul au premier frôlement. L'appui maintenu est la seule protection qui ne
// demande pas de lire quoi que ce soit.
const HOLD_MS = 900

/**
 * Alerte un proche : position, distance parcourue, temps écoulé.
 *
 * **L'app n'envoie rien elle-même.** Elle prépare le message et ouvre l'appli
 * de messagerie du téléphone ; c'est la personne qui appuie sur « envoyer ».
 * C'est délibéré : un message parti tout seul serait à la fois techniquement
 * fragile — iOS ne le permet pas sans serveur d'envoi — et fâcheux le jour où
 * le bouton est touché par erreur.
 *
 * Le contact est gardé sur l'appareil, jamais transmis.
 */
export default function SosButton({ position, distance, elapsed, className = '' }) {
  const [held, setHeld] = useState(0)
  const [asking, setAsking] = useState(false)
  const timer = useRef(null)
  const raf = useRef(null)

  useEffect(() => () => {
    clearTimeout(timer.current)
    cancelAnimationFrame(raf.current)
  }, [])

  const begin = () => {
    // Un second doigt sur le bouton relançait un minuteur sans arrêter le
    // premier : lever la main n'annulait que le dernier, et l'alerte partait
    // quand même. Un appui à la fois.
    cancel()
    const startedAt = Date.now()
    const step = () => {
      const ratio = Math.min(1, (Date.now() - startedAt) / HOLD_MS)
      setHeld(ratio)
      if (ratio < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    timer.current = setTimeout(fire, HOLD_MS)
  }

  const cancel = () => {
    clearTimeout(timer.current)
    cancelAnimationFrame(raf.current)
    setHeld(0)
  }

  function fire() {
    cancel()
    const contact = load().emergencyContact
    if (!contact) {
      setAsking(true)
      return
    }
    sendTo(contact)
  }

  function message() {
    const point = position?.current
    const where = point
      ? `https://www.google.com/maps?q=${point[1].toFixed(5)},${point[0].toFixed(5)}`
      : 'position inconnue'
    return (
      `J'ai besoin d'aide pendant ma sortie. ` +
      `Je suis ici : ${where}. ` +
      `Parcouru ${km(distance, 1)} km en ${duration(elapsed)}.`
    )
  }

  async function sendTo(contact) {
    const text = message()
    // `sms:` ouvre l'application de messagerie avec le texte prérempli. Le
    // séparateur diffère : « ?body= » sur Android, « &body= » sur iOS. Mettre
    // les deux marche partout — l'un est ignoré comme paramètre inconnu.
    // Le numéro réduit à ses chiffres (et au « + » international) : « 06.12.34 »
    // ou « 06-12-34 », tels qu'on les tape, ne sont pas des numéros pour Messages.
    const href = `sms:${contact.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(text)}`
    // Le lanceur d'iOS ouvre Messages à coup sûr, sans dépendre de la façon
    // dont WebKit traite un lien d'un autre schéma. Et s'il n'y parvient pas —
    // lien refusé, aucune app pour l'ouvrir —, la feuille de partage prend le
    // relais : un SOS qui échoue sans rien dire est le pire des cas.
    try {
      const native = await import('./native')
      const { completed } = (await native.openExternal(href)) ?? {}
      if (completed !== false) return
    } catch {
      /* le partage, ci-dessous */
    }
    await shareInstead()
  }

  async function shareInstead() {
    const text = message()
    try {
      const native = await import('./native')
      await native.shareText('Lacet — besoin d’aide', text)
    } catch (error) {
      // Refermer la feuille de partage n'est pas une panne : iOS le signale
      // comme une erreur, et le message à copier surgissait alors pour rien.
      if (!/cancel/i.test(error?.message || '')) window.prompt('Copie ce message et envoie-le :', text)
    }
    setAsking(false)
  }

  return (
    <>
      <button
        className={`btn btn--icon btn--sos ${className}`}
        style={{ '--held': held }}
        onPointerDown={begin}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        title="Alerter un proche — maintiens appuyé"
        aria-label="Alerter un proche (maintiens appuyé)"
      >
        {/* En toutes lettres : un « ! » cerclé se lit comme un avertissement de
            plus, pas comme le bouton qui prévient quelqu'un. */}
        <span className="btn--sos__label">SOS</span>
      </button>

      {asking && (
        <ContactSheet
          onClose={() => setAsking(false)}
          onSave={(number) => {
            save({ emergencyContact: number })
            setAsking(false)
            sendTo(number)
          }}
          onShare={shareInstead}
        />
      )}
    </>
  )
}

/**
 * Rendue dans `document.body`, pas à sa place dans l'arbre.
 *
 * `position: fixed` se cale sur la fenêtre — sauf si un ancêtre porte une
 * transformation, un filtre ou un `contain`, ce qui en fait un bloc conteneur.
 * Le panneau latéral en est un : la feuille s'y retrouvait enfermée, alignée en
 * bas d'une zone qui défile, donc hors de l'écran. Un portail la sort de cet
 * arbre-là sans rien changer à sa logique.
 */
function ContactSheet({ onClose, onSave, onShare }) {
  const [number, setNumber] = useState('')
  const panel = useModal(onClose)

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Contact d’urgence">
      <div className="sheet__panel" ref={panel} tabIndex={-1}>
        <h3>Prévenir qui ?</h3>
        <p className="muted">
          Aucun contact enregistré. Donne un numéro : il reste sur cet appareil et sert
          à préremplir un SMS — que tu envoies toi-même.
        </p>
        <input
          className="field"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="06 12 34 56 78"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <div className="row">
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn" onClick={onShare}>
            Partager sans enregistrer
          </button>
          <button
            className="btn btn--primary"
            disabled={number.replace(/\D/g, '').length < 6}
            onClick={() => onSave(number)}
          >
            Enregistrer et alerter
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
