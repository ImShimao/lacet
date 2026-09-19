import ActivityKit
import Capacitor
import Foundation
import UserNotifications

/// L'activité en direct d'une sortie : la consigne à venir et le temps restant,
/// sur l'écran de verrouillage et dans la Dynamic Island.
///
/// Elle est mise à jour par l'app elle-même, qui tourne en arrière-plan pendant
/// toute la sortie (mode de fond « location ») : pas de notifications push, donc
/// pas de serveur, et rien qui passe par Apple en dehors du téléphone.
///
/// **Et une notification de secours.** L'activité en direct demande une
/// extension à part, que l'installation hors App Store peut retirer, et que
/// Réglages permet de couper. Sans elle, l'écran de verrouillage restait vide :
/// la consigne passe alors dans une notification **passive** — elle ne sonne
/// pas, n'allume pas l'écran, et se remplace elle-même à chaque consigne : il
/// n'y en a jamais qu'une, toujours à jour, qu'on lit en allumant l'écran.
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
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "noticePermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearNotice", returnType: CAPPluginReturnPromise),
    ]

    private static let noticeId = "lacet-run"

    /// L'extension qui dessine l'activité est-elle dans l'app installée ?
    /// Certaines installations hors App Store la retirent : l'activité serait
    /// alors acceptée par iOS… et ne s'afficherait nulle part.
    private static var hasExtension: Bool {
        guard let plugIns = Bundle.main.builtInPlugInsURL else { return false }
        return FileManager.default.fileExists(atPath: plugIns.appendingPathComponent("LacetWidgets.appex").path)
    }

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
            call.resolve(["started": false, "reason": "iOS 16.2 requis"])
            return
        }
        guard Self.hasExtension else {
            call.resolve(["started": false, "reason": "extension d'écran verrouillé absente de l'app installée"])
            return
        }
        let name = call.getString("name") ?? "Sortie"
        let state = Self.state(from: call)
        // **Sur le fil principal.** Capacitor exécute les modules natifs sur un
        // fil de fond ; ActivityKit, lui, veut le fil principal et l'app au
        // premier plan. Appelée d'ailleurs, `request` échoue selon les versions
        // d'iOS — parfois sans rien dire, ce qui laisse un écran de
        // verrouillage vide et aucune explication.
        Task { @MainActor in
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
                // Le compte d'activités vivantes : iOS a-t-il vraiment accepté ?
                call.resolve(["started": true, "count": Activity<LacetRunAttributes>.activities.count])
            } catch {
                // Rendu plutôt que rejeté : c'est une réponse, pas une panne, et
                // le message d'iOS doit arriver jusqu'à l'écran.
                call.resolve(["started": false, "reason": "\(error)"])
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        let state = Self.state(from: call)
        Task { @MainActor in
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
        Task { @MainActor in
            for activity in Activity<LacetRunAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    /// Ce que l'écran de verrouillage peut afficher, pour « Mon compte ».
    @objc func status(_ call: CAPPluginCall) {
        var result: [String: Any] = ["extension": Self.hasExtension]
        if #available(iOS 16.2, *) {
            result["supported"] = true
            result["enabled"] = ActivityAuthorizationInfo().areActivitiesEnabled
        } else {
            result["supported"] = false
            result["enabled"] = false
        }
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                result["notifications"] = "granted"
            case .denied:
                result["notifications"] = "denied"
            default:
                result["notifications"] = "prompt"
            }
            call.resolve(result)
        }
    }

    @objc func noticePermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }

    /// Pose — ou remplace — la notification de la sortie.
    @objc func notice(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        let content = UNMutableNotificationContent()
        content.title = call.getString("title") ?? "Lacet"
        content.body = call.getString("body") ?? ""
        content.sound = nil
        content.threadIdentifier = Self.noticeId
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .passive
        }
        // Retirée puis reposée : une seule notification, toujours la dernière
        // consigne, plutôt qu'une pile à faire défiler.
        center.removeDeliveredNotifications(withIdentifiers: [Self.noticeId])
        // `delay` sert à l'essai depuis « Mon compte » : posée pendant qu'on
        // regarde l'app, iOS ne la montre pas — elle doit arriver une fois
        // l'écran verrouillé.
        let delay = call.getDouble("delay") ?? 0
        let trigger = delay > 0 ? UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false) : nil
        let request = UNNotificationRequest(identifier: Self.noticeId, content: content, trigger: trigger)
        center.add(request) { _ in call.resolve() }
    }

    @objc func clearNotice(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.noticeId])
        center.removeDeliveredNotifications(withIdentifiers: [Self.noticeId])
        call.resolve()
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
