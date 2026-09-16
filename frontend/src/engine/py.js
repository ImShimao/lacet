// L'arithmétique de CPython, reproduite à l'identique.
//
// Le moteur est un portage fidèle de `backend/app`, et sa fidélité se vérifie :
// les deux implémentations tournent sur les mêmes données et doivent rendre les
// mêmes itinéraires. Or Python et JavaScript ne calculent pas pareil sur quatre
// opérations que le moteur utilise partout, et chacune change un résultat :
//
// - **le modulo** : `-10 % 360` vaut 350 en Python, -10 en JavaScript. Tous les
//   écarts de cap passent par là ;
// - **la division entière** : `1 // 0.1` vaut 9 en Python, alors que
//   `Math.floor(1 / 0.1)` vaut 10 — la division arrondit avant le plancher ;
// - **l'arrondi** : `round(2.5)` vaut 2 en Python (au pair), 3 en JavaScript. Le
//   budget de traversées du portail de sécurité en dépend ;
// - **la somme** : depuis Python 3.12, `sum()` compense les erreurs d'arrondi
//   (algorithme de Neumaier), l'addition naïve non.
//
// Chaque fonction ci-dessous suit le code C de CPython, pas sa documentation :
// c'est le seul moyen d'obtenir les mêmes bits.

/** `math.radians` : CPython multiplie par une constante précalculée. Écrire
 *  `x * Math.PI / 180` arrondirait dans un autre ordre. */
const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

export const radians = (x) => DEG_TO_RAD * x
export const degrees = (x) => RAD_TO_DEG * x

/** `a % b` pour des flottants, comme `float_rem` : le reste prend le signe du
 *  diviseur. */
export function pymod(a, b) {
  let r = a % b
  if (r !== 0) {
    if (b < 0 !== r < 0) r += b
  } else {
    r = b < 0 ? -0 : 0
  }
  return r
}

/** `a // b` pour des flottants, comme `_float_div_mod`. */
export function pyfloordiv(a, b) {
  let mod = a % b
  let div = (a - mod) / b
  if (mod) {
    if (b < 0 !== mod < 0) {
      mod += b
      div -= 1
    }
  }
  if (div) {
    let floordiv = Math.floor(div)
    if (div - floordiv > 0.5) floordiv += 1
    return floordiv
  }
  // Zéro du signe du vrai quotient. `Math.sign(-0) < 0` est faux : il faut
  // tester -0 explicitement, sinon `-0.0 // 500` rendrait +0 là où CPython rend -0.
  const q = a / b
  return q < 0 || Object.is(q, -0) ? -0 : 0
}

/** `round()` du C : la demi-unité s'éloigne de zéro. `Math.round` la pousse
 *  vers +∞, ce qui diffère pour les négatifs. La soustraction est exacte. */
function cRound(x) {
  let r = Math.trunc(x)
  if (Math.abs(x - r) >= 0.5) r += Math.sign(x)
  return r
}

/** `round(x)` sans décimales : arrondi au pair sur les demi-unités exactes. */
export function pyRoundInt(x) {
  let r = cRound(x)
  if (Math.abs(x - r) === 0.5) r = 2 * cRound(x / 2)
  return r
}

/**
 * `f"{x:.{n}f}"` : la valeur binaire **exacte** arrondie au pair.
 *
 * `toFixed` arrondit déjà la valeur exacte — mais une égalité parfaite part vers
 * le haut. On la détecte sur le développement décimal complet (exact tant que la
 * partie fractionnaire du flottant tient en cent chiffres, ce qui couvre tout ce
 * que le moteur manipule) et on revient à l'unité paire.
 */
export function pyFixed(x, n) {
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'nan'
  const negative = x < 0 || Object.is(x, -0)
  const ax = Math.abs(x)
  let s = ax.toFixed(n)

  // Une égalité parfaite à n décimales impose x = m / 2^(n+1) exactement : un
  // flottant qui a plus de n+1 chiffres binaires après la virgule ne peut pas en
  // être une. C'est le cas de presque toutes les coordonnées, et ce test
  // évite alors le développement sur cent décimales — appelé des dizaines de
  // milliers de fois quand on arrondit la géométrie d'un itinéraire.
  if (!Number.isInteger(ax * 2 ** (n + 1))) return negative ? `-${s}` : s

  const exact = ax.toFixed(100)
  const tail = exact.slice(exact.indexOf('.') + 1 + n)
  if (/^50*$/.test(tail)) {
    const last = Number(s[s.length - 1])
    // L'unité supérieure est impaire : l'inférieure est paire, et la retirer
    // n'emprunte jamais — un chiffre impair vaut au moins 1.
    if (last % 2 === 1) s = s.slice(0, -1) + String(last - 1)
  }
  return negative ? `-${s}` : s
}

/** `round(x, n)` pour n ≥ 1 : même arrondi exact que le formatage. */
export function pyRound(x, n) {
  return Number(pyFixed(x, n))
}

/**
 * `sum()` sur des flottants, comme `builtin_sum_impl` depuis Python 3.12 :
 * somme compensée de Neumaier.
 *
 * Le départ vaut l'entier 0 : le premier flottant rencontré est pris tel quel
 * (0 + x est exact), la compensation ne s'applique qu'aux suivants, et la
 * correction accumulée n'est ajoutée qu'à la fin — et seulement si elle est
 * finie, pour ne pas changer une somme infinie en NaN.
 */
export function pySum(values) {
  let started = false
  let total = 0
  let c = 0
  for (const x of values) {
    if (!started) {
      // `0 + x`, pas `x` : CPython part de l'entier 0, ce qui change -0.0 en +0.0.
      total = 0 + x
      started = true
      continue
    }
    const t = total + x
    if (Math.abs(total) >= Math.abs(x)) c += total - t + x
    else c += x - t + total
    total = t
  }
  if (c && Number.isFinite(c)) total += c
  return total
}

// --- math.hypot ---------------------------------------------------------------
//
// Mesuré : `Math.hypot` diffère de CPython dans 40 % des cas, et `Math.sqrt(x²+y²)`
// dans 15 %. CPython calcule l'hypoténuse par une somme compensée (`vector_norm`)
// qui ne dépend d'aucune bibliothèque mathématique — donc reproductible au bit
// près. Elle sert à la rondeur des boucles, et donc au portail de forme.

const bits = new DataView(new ArrayBuffer(8))

/** Exposant `e` tel que |x| = m · 2^e avec m ∈ [0,5 ; 1[, comme `frexp`. */
function frexpExponent(x) {
  bits.setFloat64(0, x)
  const raw = (bits.getUint16(0) >> 4) & 0x7ff
  return raw - 1022
}

/** 2^e exact, pour un exposant de nombre normal. */
function pow2(e) {
  bits.setFloat64(0, 0)
  bits.setUint16(0, (e + 1023) << 4)
  return bits.getFloat64(0)
}

/** Découpe de Dekker : x = hi + lo, chaque moitié assez courte pour que leurs
 *  produits soient exacts. Valable à toute échelle, contrairement à un découpage
 *  par troncature qui laisserait trop de bits à la partie basse d'un petit nombre. */
const SPLITTER = 134217729 // 2^27 + 1

function split(a) {
  const c = SPLITTER * a
  const hi = c - (c - a)
  return [hi, a - hi]
}

/** Produit sans perte : z + zz = x · y exactement. Même résultat que le `fma`
 *  de CPython, par l'algorithme de Dekker, faute de `fma` en JavaScript. */
function exactProduct(x, y) {
  const z = x * y
  const [x1, x2] = split(x)
  const [y1, y2] = split(y)
  const err1 = z - x1 * y1
  const err2 = err1 - x2 * y1
  const err3 = err2 - x1 * y2
  return [z, x2 * y2 - err3]
}

function fastSum(a, b) {
  const x = a + b
  return [x, a - x + b]
}

export function pyHypot(a, b) {
  const x0 = Math.abs(a)
  const y0 = Math.abs(b)
  const max = x0 > y0 ? x0 : y0
  if (!Number.isFinite(max)) return Number.isNaN(max) ? NaN : Infinity
  if (max === 0) return 0

  const scale = pow2(-frexpExponent(max))
  let csum = 1
  let frac1 = 0
  let frac2 = 0
  for (const v of [x0, y0]) {
    const x = v * scale
    const [phi, plo] = exactProduct(x, x)
    const [shi, slo] = fastSum(csum, phi)
    csum = shi
    frac1 += plo
    frac2 += slo
  }
  let h = Math.sqrt(csum - 1 + (frac1 + frac2))
  const [phi, plo] = exactProduct(-h, h)
  const [shi, slo] = fastSum(csum, phi)
  csum = shi
  frac1 += plo
  frac2 += slo
  const x = csum - 1 + (frac1 + frac2)
  h += x / (2 * h)
  return h / scale
}

/** `min(iterable)` / `max(iterable)` : en cas d'égalité, le premier gagne. */
export function pyMax(values) {
  let best
  let first = true
  for (const v of values) {
    if (first || v > best) {
      best = v
      first = false
    }
  }
  return best
}

export function pyMin(values) {
  let best
  let first = true
  for (const v of values) {
    if (first || v < best) {
      best = v
      first = false
    }
  }
  return best
}

/** Tri stable sur une clé, comme `list.sort(key=…)`. */
export function sortByKey(array, key) {
  const keyed = array.map((item, index) => ({ item, index, k: key(item) }))
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.index - b.index))
  for (let i = 0; i < keyed.length; i += 1) array[i] = keyed[i].item
  return array
}
