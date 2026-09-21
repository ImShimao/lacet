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
        CAPPluginMethod(name: "activities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "noticePermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearNotice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cardStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cardUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cardStop", returnType: CAPPluginReturnPromise),
    ]

    private static let noticeId = "lacet-run"

    /// Le paquet de l'extension qui dessine l'activité, s'il est là.
    ///
    /// Certaines installations hors App Store la retirent : l'activité serait
    /// alors acceptée par iOS… et ne s'afficherait nulle part.
    private static var extensionBundle: Bundle? {
        guard let plugIns = Bundle.main.builtInPlugInsURL else { return nil }
        let appex = plugIns.appendingPathComponent("LacetWidgets.appex")
        guard FileManager.default.fileExists(atPath: appex.path) else { return nil }
        return Bundle(url: appex)
    }

    private static var hasExtension: Bool { extensionBundle != nil }

    /// L'extension est-elle encore **rattachée** à l'app installée ?
    ///
    /// iOS n'accepte de lancer une extension que si son identifiant est un
    /// enfant de celui de l'app : `fr.lacet.app` → `fr.lacet.app.widgets`. Un
    /// installateur hors App Store qui renomme l'app — Sideloadly le fait quand
    /// l'identifiant d'origine est déjà pris, ou sur demande — rompt ce lien
    /// sans rien retirer du paquet. Le fichier `.appex` est toujours là, iOS
    /// accepte l'activité en direct… et personne ne la dessine : écran de
    /// verrouillage vide, barre noire dans la Dynamic Island.
    ///
    /// C'est la seule des quatre conditions qu'on ne pouvait pas voir depuis le
    /// téléphone, et c'est exactement le symptôme qu'on cherchait.
    private static var extensionNested: Bool {
        guard let host = Bundle.main.bundleIdentifier,
              let widget = extensionBundle?.bundleIdentifier else { return false }
        return widget.hasPrefix(host + ".")
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
        // Présente mais détachée : iOS accepterait la demande et ne dessinerait
        // rien. Autant le dire ici, plutôt que de laisser un écran vide.
        guard Self.extensionNested else {
            let host = Bundle.main.bundleIdentifier ?? "?"
            let widget = Self.extensionBundle?.bundleIdentifier ?? "?"
            call.resolve([
                "started": false,
                "reason": "l'app a été renommée à l'installation (\(host)) : l'extension \(widget) ne lui est plus rattachée",
            ])
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

    // === la carte du lecteur ===================================================
    //
    // L'autre façon de tenir l'écran de verrouillage, sans extension : Lacet
    // devient le lecteur du téléphone et y affiche la consigne. Voir
    // `NowPlayingCard.swift` pour ce que ça implique.

    @objc func cardStart(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let card = NowPlayingCard.shared
            let music = card.otherAudioPlaying
            card.onToggle = { [weak self] in
                self?.notifyListeners("runControl", data: ["action": "toggle"])
            }
            let started = card.start(
                title: call.getString("title") ?? "Sortie",
                subtitle: call.getString("subtitle") ?? "",
                icon: call.getString("icon"),
                elapsed: call.getDouble("elapsed") ?? 0,
                duration: call.getDouble("duration") ?? 0
            )
            // `interrupted` : une musique jouait, et elle vient de s'arrêter —
            // l'app le dit plutôt que de laisser croire à une panne.
            call.resolve(["started": started, "interrupted": started && music])
        }
    }

    @objc func cardUpdate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            NowPlayingCard.shared.update(
                title: call.getString("title") ?? "Sortie",
                subtitle: call.getString("subtitle") ?? "",
                icon: call.getString("icon"),
                paused: call.getBool("paused") ?? false,
                elapsed: call.getDouble("elapsed") ?? 0,
                duration: call.getDouble("duration") ?? 0
            )
            call.resolve()
        }
    }

    @objc func cardStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            NowPlayingCard.shared.stop()
            call.resolve()
        }
    }

    /// Ce qu'iOS dit des activités vivantes : combien, et dans quel état.
    ///
    /// La question qui tranche : si iOS en compte une « active » et que
    /// l'écran de verrouillage reste vide, ce n'est pas la demande qui échoue,
    /// c'est l'extension qui ne la dessine pas.
    @objc func activities(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["count": 0, "states": ""])
            return
        }
        Task { @MainActor in
            let live = Activity<LacetRunAttributes>.activities
            let states = live.map { activity -> String in
                switch activity.activityState {
                case .active: return "active"
                case .dismissed: return "écartée"
                case .ended: return "terminée"
                case .stale: return "périmée"
                @unknown default: return "inconnue"
                }
            }
            call.resolve(["count": live.count, "states": states.joined(separator: ", ")])
        }
    }

    /// Ce que l'écran de verrouillage peut afficher, pour « Mon compte ».
    @objc func status(_ call: CAPPluginCall) {
        var result: [String: Any] = [
            "extension": Self.hasExtension,
            "nested": Self.extensionNested,
            // Les deux identifiants en clair : c'est ce qu'on lit, téléphone en
            // main, pour savoir si l'installateur a renommé l'app.
            "bundle": Bundle.main.bundleIdentifier ?? "",
            "extensionBundle": Self.extensionBundle?.bundleIdentifier ?? "",
        ]
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
        let subtitle = call.getString("subtitle") ?? ""
        if !subtitle.isEmpty { content.subtitle = subtitle }
        content.body = call.getString("body") ?? ""
        content.sound = nil
        content.threadIdentifier = Self.noticeId
        // La flèche du virage, en vignette : c'est elle qui distingue une
        // consigne de navigation d'une ligne de texte de plus.
        if let icon = call.getString("icon"), let arrow = Self.attachment(named: icon) {
            content.attachments = [arrow]
        }
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

    /// La flèche du virage, copiée hors du paquet de l'app.
    ///
    /// Le système **déplace** le fichier d'une pièce jointe dans son propre
    /// stockage : lui donner directement une ressource de l'app la ferait
    /// disparaître du paquet. On lui donne donc une copie jetable.
    private static func attachment(named name: String) -> UNNotificationAttachment? {
        guard let source = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "public/turns") else {
            return nil
        }
        let copy = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("lacet-\(name)-\(UUID().uuidString).png")
        do {
            try FileManager.default.copyItem(at: source, to: copy)
            return try UNNotificationAttachment(identifier: "turn", url: copy, options: nil)
        } catch {
            return nil
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
