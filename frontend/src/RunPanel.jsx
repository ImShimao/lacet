// Le panneau du bas pendant une sortie : les chiffres, le signalement, et les
// commandes à portée de pouce. Rien ici ne suit la course — `LiveRun.jsx` s'en
// charge — : ces composants ne font qu'afficher ce qu'on leur donne.

import { useState } from 'react'
import Icon from './Icon.jsx'
import SosButton from './SosButton.jsx'
import { km, pace } from './format'
import { REPORT_KINDS } from './reports'
import { clock, clockTime, minutes, speed } from './runFormat'
import { paceLabel, speedLabel, unitLabel } from './units'

import { t } from './i18n'
/**
 * Temps restant, pause, chrono, distance, allure, tour.
 *
 * `left` : les secondes qu'il reste, ou `null` quand on ne peut pas le dire.
 * `remaining` : les mètres qu'il reste, ou `null` en course libre.
 * `onHome` : « Rentrer au départ », proposé en pause — c'est là qu'on décide
 * d'abandonner, pas en courant ; `homeNote` dit pourquoi rien n'a changé.
 */
export function RunStats({ bike, state, moving, left, remaining, paused, laps, lap, onHome, homeBusy, homeNote }) {
  return (
    <>
      {/* « Combien il reste » se lit en kilomètres dans les chiffres ; en
          courant, la question est plutôt « j'en ai pour combien de temps », et
          « je rentre à quelle heure ». Les deux se déduisent de l'allure du
          moment — celle qu'on tient vraiment, pas celle qu'on avait prévue. */}
      {left !== null && (
        <p className="live__eta">{t('Reste environ')}{' '}<b>{minutes(Math.round(left / 60))}</b>{' '}{t('· fin vers')}{' '}<b>{clockTime(Date.now() + left * 1000)}</b>
        </p>
      )}

      {paused && (
        <div className="live__paused" role="status">
          <Icon name="pause" size={17} />
          <div>
            <b>{paused === 'auto' ? t('Pause automatique') : t('En pause')}</b>
            <span>
              {homeNote ??
                (paused === 'auto'
                  ? t('Le chrono reprend tout seul dès que tu repars.')
                  : t('Reprends quand tu veux, ou termine la sortie.'))}
            </span>
          </div>
          {onHome && (
            <button className="live__home" onClick={onHome} disabled={homeBusy}>
              {homeBusy ? t('Calcul…') : t('Rentrer au départ')}
            </button>
          )}
        </div>
      )}

      <div className={`live__clock ${paused ? 'live__clock--paused' : ''}`} role="timer" aria-label={t('Temps de course')}>
        {clock(state.elapsed)}
      </div>

      {/* L'unité collée au chiffre, en petit, et un mot dessous : « Distance
          (km) » en 10 px se lisait mal en courant, et les parenthèses n'y
          ajoutaient rien. */}
      <div className="stats stats--live">
        <div>
          <b>
            {km(state.distance)}
            <small>{unitLabel()}</small>
          </b>
          <span>{t('Distance')}</span>
        </div>
        <div>
          <b>
            {bike ? speed(state.distance, state.elapsed) : pace(moving)}
            <small>{bike ? speedLabel() : paceLabel()}</small>
          </b>
          <span>{bike ? t('Vitesse') : t('Allure')}</span>
        </div>
        <div>
          <b>
            {remaining === null ? (bike ? pace(moving) : speed(state.distance, state.elapsed)) : km(remaining, 1)}
            <small>{remaining === null ? (bike ? paceLabel() : speedLabel()) : unitLabel()}</small>
          </b>
          <span>{remaining === null ? (bike ? t('Allure') : t('Vitesse')) : t('Restant')}</span>
        </div>
      </div>

      {/* Sur un parcours à tours, la question qu'on se pose en courant n'est pas
          « combien de kilomètres » mais « quel tour ». Les trois tours sont
          identiques : sans compteur, rien ne les distingue. */}
      {laps > 1 && (
        <div className="lapcount" role="status">{t('Tour')}{' '}<b>{lap}</b>{' '}{t('sur')}{' '}<b>{laps}</b>
        </div>
      )}
    </>
  )
}

/**
 * Ce que la carte ne sait pas, dit en passant devant.
 *
 * Deux appuis, sans rien à viser : on est devant l'obstacle, c'est la position
 * qui fait le signalement. Le second appui relance aussitôt le calcul d'un
 * autre chemin — voir `report` dans `LiveRun.jsx`.
 */
export function ReportButton({ disabled, onReport }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button className="signal" onClick={() => setOpen(true)} disabled={disabled}>
        <Icon name="cone" size={17} />{t('Signaler un problème ici')}
        {/* Grisé sans raison, le bouton paraissait cassé : le signalement se
            pose à la position, et il n'y en a pas encore. */}
        {disabled && <em className="signal__why">{t('en attente du GPS')}</em>}
      </button>
    )
  }
  return (
    <div className="signal signal--open" role="group" aria-label={t('Signaler un problème')}>
      {REPORT_KINDS.map((k) => (
        <button
          key={k.key}
          className="signal__kind"
          onClick={() => {
            setOpen(false)
            onReport(k.key)
          }}
        >
          <Icon name={k.icon} size={19} />
          {t(k.label)}
        </button>
      ))}
      <button className="signal__cancel" onClick={() => setOpen(false)} aria-label={t('Annuler')}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

/**
 * Collées au bas du panneau, à portée de pouce. En course : le profil, la
 * pause, le SOS. « Terminer » n'apparaît qu'en pause : un bouton d'arrêt
 * touché par erreur en courant effaçait la fin de la sortie.
 */
export function RunControls({ paused, onFinish, onProfile, onTogglePause, here, distance, elapsed }) {
  return (
    <div className="live__controls runctl">
      {paused ? (
        <button className="runctl__side runctl__stop" onClick={onFinish}>
          <Icon name="stop" size={18} />
          <span>{t('Terminer')}</span>
        </button>
      ) : (
        <button className="runctl__side" onClick={onProfile} disabled={!onProfile} aria-label={t('Voir le dénivelé prévu')}>
          <Icon name="mountain" size={19} />
          <span>{t('Dénivelé')}</span>
        </button>
      )}
      <button
        className={`runctl__main ${paused ? 'runctl__main--paused' : ''}`}
        onClick={onTogglePause}
        aria-label={paused ? t('Reprendre') : t('Mettre en pause')}
        aria-pressed={Boolean(paused)}
      >
        <Icon name={paused ? 'play' : 'pause'} size={30} strokeWidth={2.4} />
      </button>
      <SosButton position={here} distance={distance} elapsed={elapsed} className="runctl__sos" />
    </div>
  )
}
