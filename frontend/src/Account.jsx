/**
 * Mon compte : le profil local, le contact d'urgence, les cartes gardées.
 *
 * Tout y est local à l'appareil — c'est le propos de l'écran, et la raison
 * pour laquelle il ne dépend de rien d'autre que du stockage du navigateur.
 */

import { useState } from 'react'
import Icon from './Icon.jsx'
import { SPORTS } from './FiltersSheet.jsx'
import { surfaceLabel } from './format'
import { load, save } from './storage'
import { readModeSetting, setModeSetting } from './platform'
import * as offline from './offlineMaps'

export default function Account({ mode = 'full', params, geo, onClearData, onProfile }) {
  const canRun = mode === 'full'
  const [confirm, setConfirm] = useState(false)
  const [contact, setContact] = useState(() => load().emergencyContact || '')
  // L'effacement vide aussi les cartes ; le compteur, lui, a lu le journal en
  // arrivant. Sans ce rappel il continuerait d'annoncer seize mégaoctets sur un
  // stockage vide — le genre de chiffre périmé qu'on croit sur parole.
  const [version, setVersion] = useState(0)
  return (
    <div className="panel">
      <div className="origin">
        <span className="origin__pin">
          <Icon name="user" size={18} />
        </span>
        <div>
          <b>Profil local</b>
          <em>tout est stocké sur cet appareil</em>
        </div>
      </div>

      <div className="rows">
        <Row label="Activité" value={SPORTS.find((s) => s.key === params.sport)?.label} />
        <Row label="Terrain" value={surfaceLabel(params.surface)} />
        <Row label="Mode sécurité" value={params.safety === 'safe' ? 'Sûr' : 'Standard'} />
        <Row
          label="Position"
          value={
            geo.status === 'ready'
              ? `± ${Math.round(geo.accuracy)} m`
              : geo.status === 'denied'
                ? 'bloquée'
                : '—'
          }
        />
      </div>

      {canRun && (
        <>
      <h4 className="section">Gabarit</h4>
      <p className="muted small">
        Sert uniquement à estimer les calories et le nombre de pas. Rien n'est envoyé.
      </p>
      <div className="rows">
        <NumberRow
          label="Poids"
          unit="kg"
          value={params.weight_kg || 70}
          min={30}
          max={200}
          onChange={(weight_kg) => onProfile({ weight_kg })}
        />
        <NumberRow
          label="Taille"
          unit="cm"
          value={params.height_cm || 175}
          min={120}
          max={230}
          onChange={(height_cm) => onProfile({ height_cm })}
        />
      </div>

      <h4 className="section">Contact d'urgence</h4>
      <p className="muted small">
        Le bouton SOS, pendant une sortie, prépare un SMS vers ce numéro avec ta
        position. <b>L'app ne l'envoie pas</b> — c'est toi qui appuies sur envoyer.
        Le numéro reste sur cet appareil.
      </p>
      <input
        className="field"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="06 12 34 56 78"
        value={contact}
        onChange={(e) => {
          setContact(e.target.value)
          save({ emergencyContact: e.target.value.trim() })
        }}
      />

      <h4 className="section">Cartes hors ligne</h4>
      <OfflineStorage key={version} />
        </>
      )}

      <h4 className="section">Version de l'app</h4>
      <ModePicker mode={mode} />

      <p className="muted">
        Aucun compte, aucune donnée envoyée ailleurs que pour calculer les itinéraires.
        Favoris, historique et réglages vivent dans le navigateur.
      </p>

      {confirm ? (
        <div className="row">
          <button className="btn" onClick={() => setConfirm(false)}>
            Annuler
          </button>
          <button
            className="btn btn--primary"
            onClick={async () => {
              await onClearData()
              setConfirm(false)
              setVersion((v) => v + 1)
            }}
          >
            Confirmer l'effacement
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => setConfirm(true)}>
          Effacer mes données
        </button>
      )}

      <p className="disclaimer">
        Données © contributeurs OpenStreetMap (ODbL) · Fonds de carte © CARTO, © Esri,
        © OpenTopoMap · Altitudes IGN RGE ALTI et OpenTopoData.
      </p>
    </div>
  )
}

/**
 * Ce que les cartes hors ligne occupent, et de quoi tout reprendre.
 *
 * Un chiffre plutôt qu'une promesse : ces fichiers sont les seuls de l'app à se
 * compter en mégaoctets, et un stockage qui grossit sans qu'on puisse le voir
 * finit par être vidé par le navigateur — au pire moment, sans prévenir.
 */
function OfflineStorage() {
  const [total, setTotal] = useState(() => offline.totalBytes())
  const [count, setCount] = useState(() => offline.storedCount())
  const [confirm, setConfirm] = useState(false)

  if (!offline.isAvailable()) {
    return (
      <p className="muted small">
        Ce navigateur ne sait pas garder de carte hors ligne. Les parcours, eux,
        restent accessibles : ils sont déjà sur l'appareil.
      </p>
    )
  }

  return (
    <>
      <div className="rows">
        <Row label="Parcours avec carte" value={count} />
        <Row label="Espace occupé" value={offline.formatBytes(total)} />
      </div>
      <p className="muted small">
        Les tuiles sont partagées : deux boucles de la même ville ne se paient
        qu'une fois, et retirer l'une n'abîme pas l'autre.
      </p>
      <p className="muted small">
        Le détail va jusqu'au zoom {offline.TILE_ZOOM}. Sur les fonds vectoriels
        — Nuit, Clair, Plan — c'est la limite du fond lui-même : au-delà la
        carte s'agrandit sans se préciser, hors ligne exactement comme en ligne.
        Relief et Satellite sont des images, qui montent bien plus haut : hors
        ligne, elles restent vides si l'on zoome plus près.
      </p>
      {count > 0 &&
        (confirm ? (
          <div className="row">
            <button className="btn" onClick={() => setConfirm(false)}>
              Annuler
            </button>
            <button
              className="btn btn--primary"
              onClick={async () => {
                await offline.clear()
                setTotal(0)
                setCount(0)
                setConfirm(false)
              }}
            >
              Vider les cartes
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => setConfirm(true)}>
            Vider les cartes hors ligne
          </button>
        ))}
    </>
  )
}

const MODES = [
  ['auto', 'Automatique'],
  ['full', 'Complète'],
  ['planner', 'Préparation'],
]

/**
 * Forcer la version complète ou la version de préparation.
 *
 * La détection suffit presque toujours — un téléphone a la version complète,
 * un ordinateur celle qui sert à préparer. Mais elle peut se tromper : une
 * tablette qu'on emporte, un PC à écran tactile. Le réglage reste sur
 * l'appareil, comme tout le reste.
 */
function ModePicker({ mode }) {
  const [setting, setSetting] = useState(readModeSetting)
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Version de l'app">
        {MODES.map(([key, label]) => (
          <button
            key={key}
            role="radio"
            aria-checked={setting === key}
            aria-pressed={setting === key}
            onClick={() => {
              setSetting(key)
              setModeSetting(key)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {mode === 'full'
          ? 'Version complète : préparer, lancer un parcours, suivi GPS, guidage vocal, SOS et historique.'
          : 'Version de préparation : chercher, comparer et exporter des boucles. Les fonctions de course sont réservées au téléphone.'}
      </p>
    </>
  )
}

function NumberRow({ label, unit, value, min, max, onChange }) {
  return (
    <div className="rows__row">
      <span>{label}</span>
      <span className="rows__num">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Diminuer ${label.toLowerCase()}`}
        >
          <Icon name="minus" size={15} />
        </button>
        <b>
          {value} {unit}
        </b>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Augmenter ${label.toLowerCase()}`}
        >
          <Icon name="plus" size={15} />
        </button>
      </span>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="rows__row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
