// Le dernier cadrage de la carte principale, pour qui en a besoin ailleurs.
//
// L'aperçu du sélecteur de fond de carte montre l'endroit qu'on regarde, pas
// Paris par défaut : c'est là qu'on juge si un fond est lisible — sur ses
// propres rues, avec leurs noms.

let last = { center: [2.3522, 48.8566], zoom: 12 }

export const rememberCamera = (camera) => {
  last = camera
}

export const lastCamera = () => last
