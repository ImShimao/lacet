import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { searchPlaces } from './api'

/**
 * Recherche d'un point de départ, n'importe où dans le monde.
 *
 * Le champ se pilote entièrement au clavier. Ce n'est pas un raffinement : on
 * arrive ici en tapant une adresse, les doigts sur les touches, et il faut
 * pouvoir choisir sans attraper la souris. La version précédente l'interdisait
 * de deux façons — `Entrée` ne faisait rien, et passer au clavier sur un
 * résultat le faisait disparaître, puisque quitter le champ fermait la liste
 * avant qu'on ait pu l'atteindre.
 */
export default function SearchBar({ onPick }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const controller = useRef(null)

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([])
      setSearching(false)
      return undefined
    }
    // Nominatim n'accepte qu'une requête par seconde : on attend que la frappe
    // se calme avant d'interroger, et on annule la précédente.
    setSearching(true)
    const timer = setTimeout(async () => {
      controller.current?.abort()
      controller.current = new AbortController()
      try {
        setResults(await searchPlaces(query, controller.current.signal))
        setActive(0)
        setOpen(true)
      } catch {
        /* requête annulée ou hors ligne : on laisse la liste en l'état */
      } finally {
        setSearching(false)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [query])

  const choose = (place) => {
    onPick({ lat: place.lat, lon: place.lon, label: place.short })
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!results.length) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Sinon le curseur saute au début ou à la fin du texte saisi pendant
      // qu'on parcourt la liste.
      event.preventDefault()
      setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + results.length) % results.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[Math.min(active, results.length - 1)])
    }
  }

  const visible = open && results.length > 0

  return (
    <div className="search">
      <Icon name="search" size={16} className="search__icon" />
      <input
        type="search"
        value={query}
        placeholder="Chercher un lieu de départ…"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        aria-label="Chercher un lieu de départ"
        role="combobox"
        aria-expanded={visible}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={visible ? `search-result-${active}` : undefined}
      />
      {searching && query.trim().length >= 3 && (
        <span className="search__spinner" aria-hidden="true" />
      )}
      {visible && (
        <div className="search__results" id="search-results" role="listbox">
          {results.map((place, i) => (
            <button
              key={`${place.lat},${place.lon},${i}`}
              id={`search-result-${i}`}
              role="option"
              aria-selected={i === active}
              className={`search__row ${i === active ? 'search__row--on' : ''}`}
              // Empêche le champ de perdre le focus : sans ça, `blur` fermait la
              // liste avant que le clic ne l'atteigne, et il fallait un délai
              // arbitraire pour rattraper la course.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(place)}
            >
              {place.short}
              <em>{place.label}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
