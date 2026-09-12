import { useEffect, useRef } from 'react'

/**
 * Le comportement qu'on attend d'une fenêtre modale, et qu'aucun navigateur ne
 * fournit pour un simple `<div>`.
 *
 * Trois choses, qui ne se voient que si elles manquent :
 *
 * **Le focus entre.** À l'ouverture, il reste sinon sur le bouton qui a ouvert
 * la fenêtre — derrière elle. Un lecteur d'écran continue alors d'annoncer la
 * page du dessous, comme si rien ne s'était passé.
 *
 * **Le focus ne sort pas.** Sans piège, la tabulation quitte la fenêtre et
 * parcourt les commandes qu'elle recouvre : on règle des filtres qu'on ne voit
 * pas, ou on déclenche une recherche au lieu de valider.
 *
 * **Le focus revient.** À la fermeture, il retourne d'où il venait. Sinon il
 * repart au début du document et il faut retraverser toute l'interface pour
 * revenir là où on en était.
 *
 * `Échap` ferme, parce qu'une fenêtre dont on ne peut sortir qu'en visant un
 * bouton n'est pas utilisable au clavier.
 */
export default function useModal(onClose) {
  const panel = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    const node = panel.current
    if (!node) return undefined

    const focusable = () =>
      [
        ...node.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.disabled && el.offsetParent !== null)

    // Le premier élément interactif plutôt que le conteneur : on tombe ainsi
    // directement sur une commande utile, pas sur un titre. Une fenêtre peut
    // désigner le sien (`data-autofocus`) quand le premier dans l'ordre est
    // un mauvais point de départ — « Réinitialiser », en tête des filtres.
    const first = node.querySelector('[data-autofocus]') || focusable()[0]
    if (first) first.focus()
    else node.focus()

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusable()
      if (!items.length) return
      const start = items[0]
      const end = items[items.length - 1]

      // Le piège ne se referme qu'aux deux extrémités : partout ailleurs, la
      // tabulation garde son comportement naturel.
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault()
        end.focus()
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault()
        start.focus()
      }
    }

    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      // `focus` échoue si l'élément d'origine a disparu entre-temps — un bouton
      // qui n'existe plus parce que le panneau a changé, par exemple.
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus()
      }
    }
  }, [onClose])

  return panel
}
