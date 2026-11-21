import Icon from './Icon.jsx'
import { KINDS } from './pois'
import { unitLabel, unitM } from './units'

const kmText = (m) => (m / unitM()).toFixed(1).replace('.', ',')

/** Au-delà, la liste des kilomètres ne se lit plus : on dit l'écart. */
const LIST_MAX = 6

/**
 * Le plus long tronçon sans arrêt, départ et arrivée compris : c'est lui qui
 * dit s'il faut emporter sa gourde. `distance` : la longueur de la boucle.
 */
export function longestGap(stops, distance) {
  const marks = [0, ...stops.map((s) => s.along), Math.max(distance, stops.at(-1)?.along ?? 0)]
  let best = { from: 0, to: 0 }
  for (let i = 1; i < marks.length; i += 1) {
    if (marks[i] - marks[i - 1] > best.to - best.from) best = { from: marks[i - 1], to: marks[i] }
  }
  return best
}

/** Dans le détail d'un parcours : ce qu'on croise, et à quel kilomètre. */
export function StopsList({ stops, loading, complete, offline = false, prefs, distance = 0 }) {
  const kinds = Object.keys(KINDS).filter((k) => prefs?.[k])
  if (!kinds.length) return null
  if (loading) return <p className="muted small stops">Recherche des points d'eau…</p>

  return (
    <div className="stops">
      {kinds.map((kind) => {
        const here = stops.filter((s) => s.kind === kind)
        const name = here.length > 1 ? KINDS[kind].plural : KINDS[kind].label.toLowerCase()
        const gap = longestGap(here, distance)
        return (
          <div key={kind} className="stops__row">
            <Icon name={KINDS[kind].icon} size={17} />
            {here.length === 0 ? (
              <span className="muted">
                {complete
                  ? "Aucun point d'eau connu le long du tracé."
                  : offline
                    ? 'Pas de réseau : rien à montrer pour l’instant.'
                    : 'Le service d’OpenStreetMap ne répond pas pour l’instant.'}
              </span>
            ) : here.length <= LIST_MAX ? (
              <span>
                <b>
                  {here.length} {name}
                </b>{' '}
                — km {here.map((s) => kmText(s.along)).join(' · ')}
              </span>
            ) : (
              <span>
                <b>
                  {here.length} {name}
                </b>
                , le plus long tronçon sans : <b>{kmText(gap.to - gap.from)} {unitLabel()}</b> ({unitLabel()} {kmText(gap.from)} → {kmText(gap.to)})
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * En course, le prochain de chaque genre devant soi. `along` : où l'on en est
 * sur le tracé suivi.
 */
export function NextStops({ stops, along }) {
  const next = Object.keys(KINDS)
    .map((kind) => stops.find((s) => s.kind === kind && s.along > along))
    .filter(Boolean)
  if (!next.length) return null
  return (
    <div className="nextstops" role="status">
      {next.map((s) => (
        <span key={s.kind}>
          <Icon name={KINDS[s.kind].icon} size={15} />
          {KINDS[s.kind].label} dans{' '}
          <b>{s.along - along >= 1000 ? `${kmText(s.along - along)} ${unitLabel()}` : `${Math.max(10, Math.round((s.along - along) / 10) * 10)} m`}</b>
        </span>
      ))}
    </div>
  )
}
