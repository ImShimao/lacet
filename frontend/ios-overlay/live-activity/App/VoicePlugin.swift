import AVFoundation
import Capacitor
import Foundation

/// La voix du guidage, et la musique qui baisse le temps d'une consigne — puis
/// remonte.
///
/// Avant ce module, la voix venait d'une extension de synthèse vocale, et la
/// musique était baissée par la page web autour de chaque phrase : baissée
/// avant, remontée quand l'extension signalait la fin. Mais l'extension
/// attribue ses fins de phrase dans l'ordre d'arrivée, et une consigne qui en
/// coupe une autre — un virage par-dessus l'annonce d'un kilomètre — lui en
/// fait perdre une. Une seule fin perdue, et la musique ne remontait plus :
/// elle restait en sourdine jusqu'au bout de la sortie.
///
/// Ici, la musique suit ce que la voix fait vraiment. Elle baisse juste avant
/// de parler ; elle remonte quand la synthèse n'a plus rien à dire — vérifié
/// sur la synthèse elle-même, pas sur un compte de phrases. Et si iOS refuse de
/// rendre le son tout de suite (la synthèse tient encore la sortie audio
/// quelques centaines de millisecondes après le dernier mot), on réessaie.
///
/// Les podcasts et livres audio baissent comme la musique, sans se mettre en
/// pause : pas de `interruptSpokenAudioAndMixWithOthers`. Une pause à chaque
/// consigne hachait l'écoute, et certaines apps ne reprenaient pas seules.
///
/// Côté JavaScript : `registerPlugin('Voice')`, dans `src/native.js`.
@objc(VoicePlugin)
public class VoicePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "VoicePlugin"
    public let jsName = "Voice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise),
    ]

    // Le temps laissé à la musique pour baisser avant le premier mot, et au
    // dernier mot pour s'éteindre avant qu'elle remonte.
    private static let leadIn: TimeInterval = 0.2
    private static let tail: TimeInterval = 0.35
    // Rendre le son peut échouer tant que la synthèse tient la sortie audio :
    // on réessaie, d'assez près pour que la musique ne traîne pas en sourdine.
    private static let retryDelay: TimeInterval = 0.3
    private static let maxAttempts = 20

    private let synthesizer = AVSpeechSynthesizer()
    // Le retour de la musique, programmé après la dernière phrase — et annulé
    // si une autre commence entre-temps.
    private var restore: DispatchWorkItem?

    override public func load() {
        synthesizer.delegate = self
        // La voix passe par la session audio de l'app : c'est elle qu'on règle
        // pour baisser les autres, et elle qui continue écran verrouillé.
        synthesizer.usesApplicationAudioSession = true
    }

    /// Dit une phrase. `flush` (par défaut) coupe celle en cours : une consigne
    /// périmée est pire que pas de consigne. Sans lui, la phrase attend son tour
    /// — l'annonce d'un kilomètre ne coupe pas un virage.
    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let flush = call.getBool("flush") ?? true
        guard !text.isEmpty else {
            call.resolve()
            return
        }
        DispatchQueue.main.async {
            if flush && self.synthesizer.isSpeaking {
                self.synthesizer.stopSpeaking(at: .immediate)
            }
            self.lowerOthers()
            let utterance = AVSpeechUtterance(string: text)
            // La voix choisie dans les réglages (`voices`), sinon celle du système.
            // La langue de l'app (`lang`, « fr-FR » ou « en-GB ») : une voix française
            // gardée dans les réglages ne lit pas des phrases anglaises.
            let lang = call.getString("lang") ?? "fr-FR"
            let chosen = call.getString("voice")
                .flatMap { AVSpeechSynthesisVoice(identifier: $0) }
                .flatMap { $0.language.hasPrefix(String(lang.prefix(2))) ? $0 : nil }
            utterance.voice = chosen ?? AVSpeechSynthesisVoice(language: lang)
            // Le débit d'avant, un peu au-dessus du défaut, multiplié par celui
            // des réglages (0,85 lent, 1 normal, 1,15 rapide).
            let rate = Float(call.getDouble("rate") ?? 1)
            utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * 1.01 * rate)
            utterance.preUtteranceDelay = VoicePlugin.leadIn
            self.synthesizer.speak(utterance)
            call.resolve()
        }
    }

    /// Se tait, et rend le son aux autres.
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.synthesizer.isSpeaking {
                self.synthesizer.stopSpeaking(at: .immediate)
            }
            self.scheduleRestore(after: 0.1)
            call.resolve()
        }
    }

    /// Les voix installées sur l'iPhone dans la langue de l'app (`lang`, « fr » par
    /// défaut), les meilleures d'abord.
    ///
    /// Lue sur le fil principal, et relue tant qu'elle revient vide : appelée
    /// depuis le fil de Capacitor, au premier appel de l'app, iOS rendait une
    /// liste vide, et le réglage ne montrait que « Voix du système » (constaté
    /// le 2026-11-27).
    @objc func voices(_ call: CAPPluginCall) {
        let prefix = String((call.getString("lang") ?? "fr").prefix(2))
        func read(attempt: Int) {
            let all = AVSpeechSynthesisVoice.speechVoices()
            if all.isEmpty && attempt < 5 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { read(attempt: attempt + 1) }
                return
            }
            let list = all
                .filter { $0.language.hasPrefix(prefix) }
                .sorted { $0.quality.rawValue > $1.quality.rawValue }
                .map { voice -> [String: Any] in
                    [
                        "id": voice.identifier,
                        "name": voice.name,
                        "language": voice.language,
                        "enhanced": voice.quality != .default,
                    ]
                }
            call.resolve(["voices": list])
        }
        DispatchQueue.main.async { read(attempt: 0) }
    }

    // === la musique =============================================================

    /// Baisse la musique, les podcasts et les livres audio.
    private func lowerOthers() {
        restore?.cancel()
        restore = nil
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playback,
                mode: .voicePrompt,
                options: [.duckOthers]
            )
            try session.setActive(true)
        } catch {
            print("Lacet — la musique n'a pas pu être baissée : \(error)")
        }
    }

    private func scheduleRestore(after delay: TimeInterval = VoicePlugin.tail, attempt: Int = 0) {
        restore?.cancel()
        let item = DispatchWorkItem { [weak self] in
            self?.raiseOthers(attempt: attempt)
        }
        restore = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    /// Rend le son aux autres apps, dès que la voix s'est tue.
    private func raiseOthers(attempt: Int) {
        // La voix parle encore — une phrase en file, ou une nouvelle : on
        // repasse plus tard, plutôt que de compter sur une fin qui pourrait
        // ne jamais être signalée.
        if synthesizer.isSpeaking {
            scheduleRestore(after: VoicePlugin.retryDelay * 2, attempt: attempt)
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            // `notifyOthersOnDeactivation` : la musique remonte tout de suite.
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
            try? session.setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers])
            restore = nil
        } catch {
            if attempt < VoicePlugin.maxAttempts {
                scheduleRestore(after: VoicePlugin.retryDelay, attempt: attempt + 1)
            } else {
                // Dernier recours : la session reste ouverte, mais elle cesse
                // de baisser les autres.
                try? session.setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers])
                restore = nil
            }
        }
    }

    // === la synthèse ============================================================

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.scheduleRestore() }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.scheduleRestore() }
    }
}
