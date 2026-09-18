import ActivityKit
import Foundation

/// Ce que l'écran de verrouillage affiche pendant une sortie guidée.
///
/// Ce fichier est compilé deux fois : dans l'app, qui démarre et met à jour
/// l'activité, et dans l'extension `LacetWidgets`, qui la dessine. ActivityKit
/// transporte l'une vers l'autre en encodant cette structure : elle doit donc
/// être rigoureusement la même des deux côtés, d'où un seul fichier partagé.
///
/// Les valeurs arrivent déjà formatées depuis l'app (`src/lockScreen.js`) :
/// l'extension affiche, elle ne calcule rien.
@available(iOS 16.1, *)
struct LacetRunAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// La consigne à venir : « Tourne à gauche rue de la Gare ».
        var instruction: String
        /// Distance jusqu'à cette consigne : « 120 m ».
        var distance: String
        /// Le genre de virage, pour l'icône : left, slight_right, finish…
        var turn: String
        /// Ce qui reste jusqu'à l'arrivée : « 3,2 km ».
        var remaining: String
        /// Arrivée estimée. L'écran en tire un compte à rebours qui défile seul,
        /// sans que l'app ait à se réveiller chaque seconde.
        var arrival: Date
        /// Part du parcours déjà faite, de 0 à 1.
        var progress: Double
        /// Hors du tracé : l'écran le dit à la place de la consigne.
        var offRoute: Bool
    }

    /// Le nom du parcours.
    var name: String
}
