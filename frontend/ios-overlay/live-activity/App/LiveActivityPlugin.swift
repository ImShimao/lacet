import ActivityKit
import Capacitor
import Foundation

/// L'activité en direct d'une sortie : la consigne à venir et le temps restant,
/// sur l'écran de verrouillage et dans la Dynamic Island.
///
/// Elle est mise à jour par l'app elle-même, qui tourne en arrière-plan pendant
/// toute la sortie (mode de fond « location ») : pas de notifications push, donc
/// pas de serveur, et rien qui passe par Apple en dehors du téléphone.
///
/// Côté JavaScript : `registerPlugin('LiveActivity')`, dans `src/native.js`.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    /// Faux avant iOS 16.2, ou quand les activités sont coupées dans Réglages.
    @objc func available(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            call.resolve(["available": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["available": false])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["started": false])
            return
        }
        let name = call.getString("name") ?? "Sortie"
        let state = Self.state(from: call)
        Task {
            // Une sortie à la fois. Une activité laissée par un arrêt brutal de
            // l'app resterait sinon affichée à côté de la nouvelle.
            for activity in Activity<LacetRunAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            do {
                _ = try Activity.request(
                    attributes: LacetRunAttributes(name: name),
                    content: ActivityContent(state: state, staleDate: nil),
                    pushType: nil
                )
                call.resolve(["started": true])
            } catch {
                call.reject("Activité en direct refusée : \(error.localizedDescription)")
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        let state = Self.state(from: call)
        Task {
            for activity in Activity<LacetRunAttributes>.activities {
                await activity.update(ActivityContent(state: state, staleDate: nil))
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<LacetRunAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    @available(iOS 16.1, *)
    private static func state(from call: CAPPluginCall) -> LacetRunAttributes.ContentState {
        let arrivalMs = call.getDouble("arrival") ?? Date().timeIntervalSince1970 * 1000
        return LacetRunAttributes.ContentState(
            instruction: call.getString("instruction") ?? "",
            distance: call.getString("distance") ?? "",
            turn: call.getString("turn") ?? "straight",
            remaining: call.getString("remaining") ?? "",
            arrival: Date(timeIntervalSince1970: arrivalMs / 1000),
            progress: min(1, max(0, call.getDouble("progress") ?? 0)),
            offRoute: call.getBool("offRoute") ?? false,
            paused: call.getBool("paused") ?? false
        )
    }
}
