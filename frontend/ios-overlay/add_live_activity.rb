# Greffe l'activité en direct de Lacet sur le projet Xcode généré par Capacitor.
#
#     ruby ios-overlay/add_live_activity.rb ios/App/App.xcodeproj
#
# L'écran de verrouillage ne se dessine pas depuis l'app : iOS exige une
# extension à part (« Widget Extension »), avec sa propre cible dans le projet
# Xcode. Le dossier `ios/` étant régénéré à chaque compilation, cette cible est
# ajoutée ici, par la bibliothèque `xcodeproj` — celle de CocoaPods, présente
# sur les Mac de GitHub — plutôt qu'à la main dans Xcode, où elle serait
# perdue à la génération suivante.
#
# Les fichiers source ont déjà été copiés par `customize.py` :
#   ios/App/App/{LacetRunAttributes,LiveActivityPlugin,LacetBridgeViewController}.swift
#   ios/App/LacetWidgets/{LacetWidgets.swift,Info.plist}

require 'xcodeproj'

project_path = ARGV[0] || 'ios/App/App.xcodeproj'
version = ENV.fetch('APP_VERSION', '1.0')
build = ENV.fetch('BUILD_NUMBER', '1')

project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == 'App' } or abort("Cible « App » introuvable dans #{project_path}.")

if project.targets.any? { |t| t.name == 'LacetWidgets' }
  puts 'Activité en direct déjà greffée'
  exit 0
end

app_group = project.main_group.children.find { |g| g.isa == 'PBXGroup' && g.path == 'App' } or
  abort("Groupe « App » introuvable : le modèle de Capacitor a changé.")

# --- côté app : le module natif et la structure partagée ------------------------
app_sources = %w[LacetRunAttributes.swift LiveActivityPlugin.swift LacetBridgeViewController.swift]
app_refs = app_sources.map { |name| app_group.new_reference(name) }
app.add_file_references(app_refs)
shared = app_refs.first

# ActivityKit n'existe qu'à partir d'iOS 16.1, et l'app démarre dès iOS 15 : liée
# normalement, elle refuserait de s'ouvrir sur un iPhone plus ancien. Liée
# « faiblement », elle s'y ouvre et les appels sont simplement sautés
# (`#available` dans le module).
app.build_configurations.each do |config|
  flags = Array(config.build_settings['OTHER_LDFLAGS'] || '$(inherited)')
  flags += ['-weak_framework', 'ActivityKit'] unless flags.include?('ActivityKit')
  config.build_settings['OTHER_LDFLAGS'] = flags
end

# --- l'extension -------------------------------------------------------------
# L'identifiant de l'extension se **déduit** de celui de l'app, jamais écrit en
# dur : iOS ne lance une extension que si son identifiant est un enfant de celui
# de l'app (`fr.lacet.app` → `fr.lacet.app.widgets`). Écrits séparément, un
# changement d'`appId` dans capacitor.config.json romprait ce lien en silence —
# l'app s'installerait, l'activité en direct serait acceptée, et rien ne
# s'afficherait.
host_id = app.build_configurations.map { |c| c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] }.compact.uniq
abort("Identifiant de l'app introuvable ou incohérent : #{host_id.inspect}") unless host_id.size == 1
widget_id = "#{host_id.first}.widgets"

ext = project.new_target(:app_extension, 'LacetWidgets', :ios, '16.2', nil, :swift)
group = project.main_group.new_group('LacetWidgets', 'LacetWidgets')
widget_ref = group.new_reference('LacetWidgets.swift')
group.new_reference('Info.plist')
ext.add_file_references([widget_ref, shared])

ext.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = widget_id
  s['INFOPLIST_FILE'] = 'LacetWidgets/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
  s['TARGETED_DEVICE_FAMILY'] = '1'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  # Même version que l'app : iOS refuse une extension qui ne la porte pas.
  s['MARKETING_VERSION'] = version
  s['CURRENT_PROJECT_VERSION'] = build
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# --- iPhone seulement ------------------------------------------------------------
# Lacet n'a qu'une mise en page, celle du téléphone. Sur iPad, iOS l'ouvre donc
# en mode iPhone, à sa taille, plutôt que d'étirer sur dix pouces un écran
# pensé pour une main.
app.build_configurations.each { |config| config.build_settings['TARGETED_DEVICE_FAMILY'] = '1' }

# --- l'app embarque l'extension ------------------------------------------------
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
embedded = embed.add_file_reference(ext.product_reference, true)
embedded.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "Activité en direct greffée (#{project_path}) — #{host_id.first} → #{widget_id}"
