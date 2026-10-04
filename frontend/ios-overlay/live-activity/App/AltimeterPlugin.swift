import Capacitor
import CoreMotion
import Foundation

/// Le dénivelé d'une sortie, mesuré au baromètre de l'iPhone.
///
/// L'altitude du GPS tremble de plusieurs mètres d'un relevé à l'autre, et ce
/// tremblement, cumulé sur une heure, invente ou efface des côtes : on comparait
/// le dénivelé annoncé à un chiffre qui ne valait guère mieux. Le baromètre sent
/// un écart de quelques dizaines de centimètres — c'est ce que lisent les
/// montres de course, et tous les iPhone en ont un depuis l'iPhone 6.
///
/// Le cumul se fait ici, à chaque relevé (environ une fois par seconde) : la
/// page web ne le lit que de loin en loin, et une page rechargée en cours de
/// sortie ne lui fait rien perdre. Aucune autorisation spéciale à la signature —
/// seulement la phrase `NSMotionUsageDescription` (voir `customize.py`), qu'iOS
/// montre au premier départ.
///
/// Côté JavaScript : `registerPlugin('Altimeter')`, dans `src/native.js`.
@objc(AltimeterPlugin)
public class AltimeterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AltimeterPlugin"
    public let jsName = "Altimeter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let altimeter = CMAltimeter()
    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.name = "fr.lacet.altimeter"
        return queue
    }()
    // Les relevés arrivent sur `queue`, les lectures sur le fil de Capacitor.
    private let lock = NSLock()
    private var climb = Climb()
    private var failure: String?
    private var running = false

    /// Remet le cumul à zéro et commence à mesurer.
    ///
    /// Rend `available: false` quand il n'y a rien à attendre — pas de
    /// baromètre, ou l'accès refusé dans Réglages : la sortie se rabat alors
    /// sur l'altitude du GPS. Au premier appel, iOS pose la question ; un refus
    /// arrive ensuite comme une erreur de relevé, et `read` le dit.
    @objc func start(_ call: CAPPluginCall) {
        guard CMAltimeter.isRelativeAltitudeAvailable() else {
            call.resolve(["available": false, "reason": "absent"])
            return
        }
        let status = CMAltimeter.authorizationStatus()
        if status == .denied || status == .restricted {
            call.resolve(["available": false, "reason": "refusé"])
            return
        }

        lock.lock()
        climb = Climb()
        failure = nil
        let wasRunning = running
        running = true
        lock.unlock()

        if wasRunning { altimeter.stopRelativeAltitudeUpdates() }
        altimeter.startRelativeAltitudeUpdates(to: queue) { [weak self] data, error in
            guard let self = self else { return }
            self.lock.lock()
            defer { self.lock.unlock() }
            if let error = error {
                self.failure = error.localizedDescription
                return
            }
            guard let data = data else { return }
            self.climb.push(data.relativeAltitude.doubleValue, at: data.timestamp)
        }
        call.resolve(["available": true])
    }

    /// Le cumul du moment, sans rien arrêter.
    @objc func read(_ call: CAPPluginCall) {
        call.resolve(snapshot())
    }

    /// Arrête la mesure et rend le dernier cumul.
    @objc func stop(_ call: CAPPluginCall) {
        lock.lock()
        let wasRunning = running
        running = false
        lock.unlock()
        if wasRunning { altimeter.stopRelativeAltitudeUpdates() }
        call.resolve(snapshot())
    }

    private func snapshot() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        var out: [String: Any] = [
            "ascent": climb.ascent,
            "descent": climb.descent,
            "samples": climb.samples,
            "running": running,
        ]
        if let failure = failure { out["error"] = failure }
        return out
    }
}

/// Le cumul des montées et des descentes, relevé après relevé.
///
/// Un lissage de quatre secondes d'abord : le téléphone qui ballotte dans une
/// poche, une rafale contre le capteur, font osciller la pression bien plus vite
/// que n'importe quelle côte. Puis un seuil d'un mètre — le même que pour le
/// relief annoncé (`environment.js`) : une montée ne compte qu'une fois qu'elle
/// a dépassé un mètre, mais elle compte alors **depuis le creux**, en entier.
struct Climb {
    static let smoothing: TimeInterval = 4
    static let threshold = 1.0

    private(set) var ascent = 0.0
    private(set) var descent = 0.0
    private(set) var samples = 0
    private var smoothed: Double?
    private var last: TimeInterval?
    // Le dernier sommet ou le dernier creux confirmé, et le sens où l'on va.
    private var reference: Double?
    private var rising: Bool?

    mutating func push(_ metres: Double, at time: TimeInterval) {
        samples += 1
        let z: Double
        if let previous = smoothed, let then = last {
            let k = 1 - exp(-max(0, time - then) / Climb.smoothing)
            z = previous + k * (metres - previous)
        } else {
            z = metres
        }
        smoothed = z
        last = time

        guard let ref = reference else {
            reference = z
            return
        }
        switch rising {
        case .some(true):
            // En montée : le sommet suit, et seule une vraie descente le fixe.
            if z > ref {
                ascent += z - ref
                reference = z
            } else if ref - z >= Climb.threshold {
                descent += ref - z
                reference = z
                rising = false
            }
        case .some(false):
            if z < ref {
                descent += ref - z
                reference = z
            } else if z - ref >= Climb.threshold {
                ascent += z - ref
                reference = z
                rising = true
            }
        case .none:
            if z - ref >= Climb.threshold {
                ascent += z - ref
                reference = z
                rising = true
            } else if ref - z >= Climb.threshold {
                descent += ref - z
                reference = z
                rising = false
            }
        }
    }
}
