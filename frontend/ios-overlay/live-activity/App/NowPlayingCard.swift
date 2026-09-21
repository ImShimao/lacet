import AVFoundation
import MediaPlayer
import UIKit

/// La consigne sur l'écran de verrouillage, par la carte du lecteur audio.
///
/// **Pourquoi passer par là.** L'activité en direct est la bonne façon de tenir
/// l'écran de verrouillage — et elle exige une extension qu'iOS n'accepte de
/// lancer que sur une app correctement signée. Une installation hors App Store
/// peut renommer l'app et détacher l'extension : iOS accepte alors l'activité et
/// ne dessine rien. La carte du lecteur, elle, ne demande aucune extension :
/// c'est l'app elle-même qui la remplit, et n'importe quelle installation la
/// montre. Le prix est explicite — pendant la sortie, Lacet **devient** le
/// lecteur du téléphone, et la musique qui jouait s'arrête.
///
/// Ce qu'elle affiche tombe juste sur ce qu'on veut lire en courant : la
/// pochette (la flèche du virage), le titre (la consigne), le sous-titre (la
/// distance), et un bouton lecture/pause — branché ici sur la **pause de la
/// sortie**, chrono compris.
///
/// La session audio doit rester **exclusive** : en `mixWithOthers`, iOS n'accepte
/// plus les mises à jour de la carte, et elle reste figée sur ce que jouait
/// l'app précédente. D'où le silence joué en boucle : tant que rien ne sort des
/// haut-parleurs, la carte ne tient pas.
final class NowPlayingCard {
    static let shared = NowPlayingCard()

    /// Appelée quand on touche lecture/pause sur l'écran de verrouillage.
    var onToggle: (() -> Void)?

    private var player: AVAudioPlayer?
    private var wired = false

    /// Une musique joue-t-elle en ce moment ? Sert à prévenir, pas à empêcher.
    var otherAudioPlaying: Bool { AVAudioSession.sharedInstance().isOtherAudioPlaying }

    var running: Bool { player?.isPlaying == true }

    /// Prend la carte. Rend `false` si le silence n'a pas pu être joué — sans
    /// audio qui sort, iOS ne donne la carte à personne.
    @discardableResult
    func start(title: String, subtitle: String, icon: String?, elapsed: Double = 0, duration: Double = 0) -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            // Exclusive, et sans `.mixWithOthers` : c'est la condition pour
            // tenir la carte. `.duckOthers` laisserait la musique en fond, mais
            // baissée toute la sortie.
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            return false
        }

        if player == nil {
            guard let url = Bundle.main.url(forResource: "silence", withExtension: "wav", subdirectory: "public")
                ?? Bundle.main.url(forResource: "silence", withExtension: "wav") else { return false }
            player = try? AVAudioPlayer(contentsOf: url)
            player?.numberOfLoops = -1
            player?.volume = 1
        }
        guard player?.play() == true else { return false }

        wireCommands()
        UIApplication.shared.beginReceivingRemoteControlEvents()
        update(title: title, subtitle: subtitle, icon: icon, paused: false, elapsed: elapsed, duration: duration)
        return true
    }

    func update(title: String, subtitle: String, icon: String?, paused: Bool, elapsed: Double = 0, duration: Double = 0) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: subtitle,
            MPMediaItemPropertyAlbumTitle: "Lacet",
            MPNowPlayingInfoPropertyPlaybackRate: paused ? 0.0 : 1.0,
        ]
        // La barre du lecteur devient celle de la sortie : le temps couru d'un
        // côté, l'arrivée estimée de l'autre. Sans durée, iOS écrit « EN DIRECT »
        // sur une barre vide, qui n'apprend rien.
        if duration > elapsed, duration > 1 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
            info[MPNowPlayingInfoPropertyIsLiveStream] = false
        } else {
            info[MPNowPlayingInfoPropertyIsLiveStream] = true
        }
        if let icon, let art = Self.artwork(named: icon) {
            info[MPMediaItemPropertyArtwork] = art
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        if #available(iOS 13.0, *) {
            MPNowPlayingInfoCenter.default().playbackState = paused ? .paused : .playing
        }
    }

    /// Rend la carte et la session : la musique du téléphone peut repartir.
    func stop() {
        player?.stop()
        player = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        if #available(iOS 13.0, *) {
            MPNowPlayingInfoCenter.default().playbackState = .stopped
        }
        UIApplication.shared.endReceivingRemoteControlEvents()
        // On revient au réglage de l'app : la voix du guidage par-dessus la
        // musique, sans la confisquer.
        try? AVAudioSession.sharedInstance().setCategory(
            .playback, mode: .voicePrompt, options: [.mixWithOthers]
        )
    }

    /// Les boutons de l'écran de verrouillage, branchés sur la pause de la sortie.
    private func wireCommands() {
        guard !wired else { return }
        wired = true
        let center = MPRemoteCommandCenter.shared()
        let toggle: (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus = { [weak self] _ in
            self?.onToggle?()
            return .success
        }
        center.playCommand.addTarget(handler: toggle)
        center.pauseCommand.addTarget(handler: toggle)
        center.togglePlayPauseCommand.addTarget(handler: toggle)
        // Ce qui ne veut rien dire pour une sortie : on le retire, sinon iOS
        // dessine des boutons « piste suivante » inertes.
        for unused in [center.nextTrackCommand, center.previousTrackCommand,
                       center.skipForwardCommand, center.skipBackwardCommand,
                       center.changePlaybackPositionCommand] {
            unused.isEnabled = false
        }
    }

    /// La flèche du virage, en pochette — les mêmes images que la notification.
    private static func artwork(named name: String) -> MPMediaItemArtwork? {
        let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "public/turns")
        guard let url, let image = UIImage(contentsOfFile: url.path) else { return nil }
        return MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }
}
