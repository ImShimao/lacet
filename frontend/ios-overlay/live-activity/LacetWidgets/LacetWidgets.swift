import ActivityKit
import SwiftUI
import WidgetKit

/// L'extension qui dessine l'activité en direct d'une sortie.
///
/// Elle ne fait qu'afficher : l'app calcule tout et lui envoie des valeurs déjà
/// formatées (`LacetRunAttributes`).
///
/// **Écrite pour ne jamais rendre du vide.** Sur l'iPhone de test, iOS acceptait
/// l'activité — la Dynamic Island s'ouvrait sur l'app — et n'affichait qu'une
/// barre noire. Deux causes possibles : une vue qui ne dessine rien, ou un état
/// arrivé vide. Les deux sont traitées ici :
///
/// - chaque zone porte **son propre fond et un repère visible** (« LACET ») :
///   une vue qui s'affiche se voit, même si toutes les valeurs manquent ;
/// - chaque valeur a un **repli** (« — ») : plus de texte vide sur fond noir ;
/// - plus rien qui puisse échouer à l'affichage. Le compte à rebours de
///   `Text(timerInterval:)` et la `ProgressView` sont remplacés par du texte et
///   une barre dessinée à la main : l'app sait déjà tout calculer, et une vue
///   qui plante dans une extension ne laisse aucune trace visible.
@main
struct LacetWidgetBundle: WidgetBundle {
    var body: some Widget {
        LacetRunActivity()
        LacetShortcut()
    }
}

/// Une petite vignette pour l'écran d'accueil.
///
/// Elle sert d'abord de **preuve** : un widget se pose à la main depuis la
/// galerie d'iOS. S'il s'affiche, l'extension tourne, et un écran de
/// verrouillage vide ne peut venir que de l'activité elle-même. S'il n'apparaît
/// même pas dans la galerie, c'est l'extension qu'iOS refuse de lancer — et
/// aucune ligne de code ne l'y forcera : c'est la signature de l'installation.
struct LacetShortcut: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LacetShortcut", provider: ShortcutProvider()) { _ in
            ShortcutView()
        }
        .configurationDisplayName("Lacet")
        .description("Ouvrir Lacet pour lancer une sortie.")
        .supportedFamilies([.systemSmall])
    }
}

struct ShortcutEntry: TimelineEntry {
    let date: Date
}

struct ShortcutProvider: TimelineProvider {
    func placeholder(in context: Context) -> ShortcutEntry { ShortcutEntry(date: Date()) }

    func getSnapshot(in context: Context, completion: @escaping (ShortcutEntry) -> Void) {
        completion(ShortcutEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ShortcutEntry>) -> Void) {
        completion(Timeline(entries: [ShortcutEntry(date: Date())], policy: .never))
    }
}

struct ShortcutView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("LACET")
                .font(.system(size: 15, weight: .black))
                .foregroundColor(accent)
            Text("Trouver ma boucle")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
        .lacetBackground()
    }
}

// Les couleurs de l'app : le violet de l'accent sur le noir du fond.
private let accent = Color(red: 0.608, green: 0.435, blue: 1.0)
private let backdrop = Color(red: 0.039, green: 0.035, blue: 0.063)
private let caution = Color(red: 1.0, green: 0.416, blue: 0.271)

/// Le fond, posé comme iOS 17 et suivants l'exigent.
///
/// Depuis iOS 17, une vue de widget — activité en direct comprise — doit
/// déclarer son fond par `containerBackground`. Un fond posé à l'ancienne, en
/// `background`, peut se retrouver ignoré, et la vue rendue sur du vide.
extension View {
    @ViewBuilder
    func lacetBackground() -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(backdrop, for: .widget)
        } else {
            background(backdrop)
        }
    }
}

/// Ce qu'on affiche quand une valeur manque — plutôt qu'un espace vide.
private func shown(_ value: String, fallback: String = "—") -> String {
    value.trimmingCharacters(in: .whitespaces).isEmpty ? fallback : value
}

struct LacetRunActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LacetRunAttributes.self) { context in
            LockScreenView(state: context.state, name: context.attributes.name)
                .activityBackgroundTint(backdrop)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        TurnIcon(state: context.state)
                            .font(.system(size: 24, weight: .bold))
                        Text("LACET")
                            .font(.system(size: 11, weight: .black))
                            .foregroundColor(accent)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(shown(context.state.remaining))
                        .font(.system(size: 16, weight: .semibold).monospacedDigit())
                        .foregroundColor(.white)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.offRoute ? "Hors parcours" : shown(context.state.distance))
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(headline(context.state))
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.85))
                            .lineLimit(2)
                        Bar(progress: context.state.progress)
                    }
                }
            } compactLeading: {
                TurnIcon(state: context.state)
            } compactTrailing: {
                Text(context.state.offRoute ? "!" : shown(context.state.distance, fallback: "Lacet"))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundColor(.white)
            } minimal: {
                TurnIcon(state: context.state)
            }
            .keylineTint(accent)
        }
    }
}

/// L'écran de verrouillage : ce qu'on lit en allumant l'écran, en courant.
///
/// Dans l'ordre où l'œil le cherche : l'icône du virage et sa distance, en
/// grand ; la consigne en toutes lettres ; puis l'avancée, ce qui reste et
/// l'heure d'arrivée.
struct LockScreenView: View {
    let state: LacetRunAttributes.ContentState
    let name: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("LACET")
                    .font(.system(size: 11, weight: .black))
                    .foregroundColor(accent)
                Text(shown(name, fallback: "Sortie"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            HStack(alignment: .center, spacing: 12) {
                TurnIcon(state: state)
                    .font(.system(size: 30, weight: .bold))
                    .frame(width: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.offRoute ? "Hors parcours" : shown(state.distance))
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.white)
                    Text(headline(state))
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.8))
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            Bar(progress: state.progress)
            HStack {
                Text("Reste \(shown(state.remaining))")
                Spacer()
                Text(state.paused ? "En pause" : "Arrivée \(arrivalText(state.arrival))")
            }
            .font(.footnote.weight(.semibold).monospacedDigit())
            .foregroundColor(.white.opacity(0.85))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        // Le fond est posé ici, en plus de la teinte demandée au système : une
        // vue qui s'affiche doit se voir, quoi qu'il arrive au tint.
        .lacetBackground()
    }
}

/// L'avancée, dessinée à la main : deux capsules, rien qui puisse échouer.
struct Bar: View {
    let progress: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.18))
                Capsule()
                    .fill(accent)
                    .frame(width: max(0, min(1, progress)) * geo.size.width)
            }
        }
        .frame(height: 5)
    }
}

/// L'heure d'arrivée, en clair — « 18h42 ».
///
/// Un compte à rebours qui défile serait plus vivant, mais `Text(timerInterval:)`
/// exige un intervalle strictement futur : une arrivée dépassée d'une seconde
/// fait échouer la vue, et une extension qui échoue n'affiche rien du tout.
func arrivalText(_ date: Date) -> String {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
    guard let hour = parts.hour, let minute = parts.minute else { return "—" }
    return String(format: "%dh%02d", hour, minute)
}

struct TurnIcon: View {
    let state: LacetRunAttributes.ContentState

    var body: some View {
        Image(systemName: state.offRoute ? "exclamationmark.triangle.fill" : symbol(for: state.turn))
            .foregroundColor(state.offRoute ? caution : accent)
    }
}

/// La consigne, ou ce qu'il faut faire quand on n'est plus sur le tracé.
func headline(_ state: LacetRunAttributes.ContentState) -> String {
    if state.offRoute { return "Reviens sur le tracé pour reprendre le guidage." }
    return shown(state.instruction, fallback: "Sortie en cours")
}

/// Le pictogramme d'un virage, tel que le nomme le moteur (`navigation.js`).
func symbol(for turn: String) -> String {
    switch turn {
    case "finish": return "flag.checkered"
    case "start": return "figure.run"
    case "lap": return "arrow.clockwise"
    case "uturn": return "arrow.uturn.left"
    case "slight_left": return "arrow.up.left"
    case "slight_right": return "arrow.up.right"
    case "left", "sharp_left": return "arrow.turn.up.left"
    case "right", "sharp_right": return "arrow.turn.up.right"
    default: return "arrow.up"
    }
}
