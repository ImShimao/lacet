import ActivityKit
import AVFoundation
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
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "duck", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unduck", returnType: CAPPluginReturnPromise),
    ]

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

    /// L'extension a-t-elle reçu son propre profil de signature ?
    ///
    /// iOS ne lance une extension que si elle est provisionnée **pour
    /// elle-même** : son `embedded.mobileprovision`, à côté de celui de l'app.
    /// Un installateur qui signe l'app et oublie ses extensions produit
    /// exactement ce qu'on observe — l'extension est là, rattachée, complète,
    /// et le système l'ignore : ni widget dans la galerie, ni activité dessinée.
    ///
    /// C'est la dernière chose qu'on pouvait encore vérifier depuis l'app, et
    /// elle dit si un autre compte de signature changerait quelque chose.
    private static func provisioned(_ bundle: Bundle?) -> Bool {
        guard let url = bundle?.bundleURL else { return false }
        return FileManager.default.fileExists(atPath: url.appendingPathComponent("embedded.mobileprovision").path)
    }

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

    /// Ce que l'écran de verrouillage peut afficher, pour « Mon compte ».
    @objc func status(_ call: CAPPluginCall) {
        var result: [String: Any] = [
            "extension": Self.hasExtension,
            "nested": Self.extensionNested,
            // Les profils de signature, app et extension : voir `provisioned`.
            "signedApp": Self.provisioned(Bundle.main),
            "signedExtension": Self.provisioned(Self.extensionBundle),
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
        call.resolve(result)
    }

    // === la voix par-dessus la musique ========================================

    /// Baisse la musique le temps d'une consigne, et la remet ensuite.
    ///
    /// La session audio de l'app mélange avec ce qui joue déjà : sans rien de
    /// plus, la voix se perd dans le refrain, précisément au carrefour où l'on
    /// avait besoin d'elle. `.duckOthers` baisse l'autre app pendant que la
    /// nôtre est active — d'où l'activation juste avant la phrase et la
    /// désactivation juste après, plutôt qu'une musique en sourdine toute la
    /// sortie. `notifyOthersOnDeactivation` lui rend son volume tout de suite.
    @objc func duck(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers, .duckOthers])
        try? session.setActive(true)
        call.resolve()
    }

    @objc func unduck(_ call: CAPPluginCall) {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
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
