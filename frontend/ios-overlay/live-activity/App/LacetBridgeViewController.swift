import Capacitor
import UIKit

/// Le contrôleur de l'app, qui enregistre les modules natifs propres à Lacet.
///
/// Depuis Capacitor 6, un module écrit dans l'app elle-même — et non livré par
/// un paquet npm — n'est découvert par personne : il faut l'enregistrer ici. Le
/// `SceneDelegate` généré par Capacitor est réglé pour créer ce contrôleur-ci
/// plutôt que celui d'origine (voir `ios-overlay/customize.py`).
class LacetBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(AltimeterPlugin())
    }
}
