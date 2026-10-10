import Capacitor
import CoreLocation
import Foundation

/// Où pointe l'iPhone, pour le faisceau autour du point de position.
///
/// Le point seul ne dit pas de quel côté partir : au premier carrefour, on
/// tourne sur soi-même en cherchant la rue sur la carte. Le cap du GPS ne sert
/// à rien à l'arrêt, et en course il donne le sens du déplacement, pas celui
/// du regard. La boussole, elle, répond tout de suite — c'est le faisceau de
/// Google Maps. Aucune autorisation de plus : celle de la position suffit.
///
/// Le cap est celui du nord géographique quand iOS le connaît, sinon le
/// magnétique : en France, deux degrés d'écart au plus, invisibles sur un
/// faisceau de soixante.
///
/// Côté JavaScript : `registerPlugin('Compass')`, dans `src/native.js` — un
/// événement `heading` par changement de plus de trois degrés.
@objc(CompassPlugin)
public class CompassPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "CompassPlugin"
    public let jsName = "Compass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    // Créé sur le fil principal, comme iOS l'exige pour livrer les relevés.
    private var manager: CLLocationManager?

    /// Rend `available: false` sur un appareil sans magnétomètre : le point
    /// reste alors un point, et la flèche de course suit le tracé.
    @objc func start(_ call: CAPPluginCall) {
        guard CLLocationManager.headingAvailable() else {
            call.resolve(["available": false])
            return
        }
        DispatchQueue.main.async {
            if self.manager == nil {
                let manager = CLLocationManager()
                manager.delegate = self
                // Trois degrés : en dessous, le faisceau frémit dans la main sans
                // rien apprendre de plus, et chaque relevé réveille la page.
                manager.headingFilter = 3
                self.manager = manager
            }
            self.manager?.startUpdatingHeading()
            call.resolve(["available": true])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.manager?.stopUpdatingHeading()
            call.resolve()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        // Une précision négative : le relevé ne vaut rien (aimant tout près,
        // boussole à calibrer). Mieux vaut le faisceau d'avant qu'un faux.
        guard newHeading.headingAccuracy >= 0 else { return }
        let heading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        notifyListeners("heading", data: ["heading": heading, "accuracy": newHeading.headingAccuracy])
    }

    // Le huit de calibration en plein écran, au milieu d'une sortie : jamais.
    public func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        false
    }
}
