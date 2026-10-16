import Cocoa
import WebKit
#if canImport(Sparkle)
import Sparkle
#endif

final class FaceWindow: NSWindow {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
}

final class FaceWebView: WKWebView {
  override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
    menu.removeAllItems()
  }

  override var acceptsFirstResponder: Bool { true }

  /** First click on an inactive window should press buttons, not just focus. */
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func keyDown(with event: NSEvent) {
    if event.modifierFlags.contains(.command) || event.modifierFlags.contains(.control) {
      super.keyDown(with: event)
      return
    }
    let raw = event.charactersIgnoringModifiers ?? ""
    let key: String
    if event.keyCode == 53 {
      key = "Escape"
    } else if raw.isEmpty {
      super.keyDown(with: event)
      return
    } else {
      key = raw
    }
    let escaped = key
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
    evaluateJavaScript("window.sphereKey && window.sphereKey(\"\(escaped)\")", completionHandler: nil)
  }
}

final class DragRegion: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
  override var acceptsFirstResponder: Bool { false }

  // Only claim clicks that actually land on the strip: `point` is in the
  // superview's coordinates, and returning self unconditionally would steal
  // every click in the window from the web view below.
  override func hitTest(_ point: NSPoint) -> NSView? {
    frame.contains(point) ? self : nil
  }

  override func mouseDown(with event: NSEvent) {
    window?.performDrag(with: event)
    if let web = window?.contentView?.subviews.compactMap({ $0 as? WKWebView }).first {
      window?.makeFirstResponder(web)
    }
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .arrow)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSTextFieldDelegate, WKScriptMessageHandler {
  static let shared = AppDelegate()

  private var window: NSWindow?
  private var settingsWindow: NSWindow?
  private var settingsWeb: WKWebView?
  private var lastState: [String: Any] = [:]
  private var web: WKWebView?
  private var worker: Process?
  private var quitting = false
  /// When the worker last crashed, so a crash loop stops at the failure page instead of restarting forever.
  private var crashTimes: [Date] = []
  private var loadTimer: Timer?
  private var stateTimer: Timer?
  private var url = URL(string: "http://127.0.0.1:4101/")!
  private var keyBar: NSView?
  private var keyField: NSTextField?
  private var keyError: NSTextField?
  private var keyBusy = false
  private var statusItem: NSStatusItem?
  private var dragStrip: NSView?
  #if canImport(Sparkle)
  private lazy var updaterController: SPUStandardUpdaterController? = {
    let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
    let feed = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String ?? ""
    guard !key.isEmpty, !feed.isEmpty else { return nil }
    return SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
  }()
  #endif

  func applicationDidFinishLaunching(_ notification: Notification) {
    if CommandLine.arguments.count > 1, let given = URL(string: CommandLine.arguments[1]), given.scheme == "http" {
      url = given
    } else {
      startWorker()
    }
    buildMenu()
    buildStatusItem()
    buildWindow()
    waitThenLoad()
    #if canImport(Sparkle)
    _ = updaterController
    #endif
  }

  @objc private func showSettings(_ sender: Any?) {
    if settingsWindow == nil { buildSettingsWindow() }
    settingsWeb?.load(URLRequest(url: url.appendingPathComponent("settings"), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
    settingsWindow?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "sphere", let body = message.body as? String else { return }
    DispatchQueue.main.async {
      if body == "settings" {
        self.showSettings(nil)
      } else if body == "updates" {
        self.checkForUpdates(nil)
      } else if body == "world" {
        self.openWorld(nil)
      } else if body == "inbox-open" {
        self.dragStrip?.isHidden = true
      } else if body == "inbox-close" {
        self.dragStrip?.isHidden = false
      }
    }
  }

  /// The face server knows which coordinator this machine joined.
  @objc private func openWorld(_ sender: Any?) {
    let link = url.appendingPathComponent("open-world")
    URLSession.shared.dataTask(with: link) { data, _, _ in
      guard
        let data,
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let raw = obj["url"] as? String,
        let page = URL(string: raw)
      else { return }
      DispatchQueue.main.async { NSWorkspace.shared.open(page) }
    }.resume()
  }

  @objc private func checkForUpdates(_ sender: Any?) {
    #if canImport(Sparkle)
    updaterController?.checkForUpdates(sender)
    #endif
  }

  private func buildSettingsWindow() {
    let panel = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 420, height: 640),
      styleMask: [.titled, .closable, .miniaturizable],
      backing: .buffered,
      defer: false
    )
    panel.title = "Settings"
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    panel.isReleasedWhenClosed = false
    panel.backgroundColor = NSColor(calibratedRed: 0.08, green: 0.086, blue: 0.11, alpha: 1)
    panel.appearance = NSAppearance(named: .darkAqua)
    panel.level = .normal
    panel.collectionBehavior = [.moveToActiveSpace]
    panel.minSize = NSSize(width: 380, height: 520)

    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "sphere")
    let web = WKWebView(frame: .zero, configuration: config)
    web.setValue(false, forKey: "drawsBackground")
    web.translatesAutoresizingMaskIntoConstraints = false
    let root = NSView()
    root.wantsLayer = true
    root.layer?.backgroundColor = panel.backgroundColor.cgColor
    root.addSubview(web)
    panel.contentView = root
    NSLayoutConstraint.activate([
      web.topAnchor.constraint(equalTo: root.topAnchor),
      web.bottomAnchor.constraint(equalTo: root.bottomAnchor),
      web.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      web.trailingAnchor.constraint(equalTo: root.trailingAnchor),
    ])
    panel.center()
    settingsWindow = panel
    settingsWeb = web
  }

  private func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appItem.submenu = appMenu
    appMenu.addItem(withTitle: "About Autopia", action: nil, keyEquivalent: "")
    appMenu.addItem(.separator())
    let settings = NSMenuItem(title: "Settings…", action: #selector(showSettings(_:)), keyEquivalent: ",")
    settings.target = self
    appMenu.addItem(settings)
    let world = NSMenuItem(title: "Open World", action: #selector(openWorld(_:)), keyEquivalent: "")
    world.target = self
    appMenu.addItem(world)
    let updates = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates(_:)), keyEquivalent: "")
    updates.target = self
    appMenu.addItem(updates)
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide Autopia", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "Quit Autopia", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    main.addItem(appItem)
    NSApp.mainMenu = main
  }

  private func buildStatusItem() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    item.button?.image = menuBarEyesImage()
    item.button?.toolTip = "Autopia"
    item.button?.imagePosition = .imageOnly
    let menu = NSMenu()
    let show = NSMenuItem(title: "Show Face", action: #selector(showFace), keyEquivalent: "")
    show.target = self
    menu.addItem(show)
    let settings = NSMenuItem(title: "Settings…", action: #selector(showSettings(_:)), keyEquivalent: ",")
    settings.target = self
    menu.addItem(settings)
    let world = NSMenuItem(title: "Open World", action: #selector(openWorld(_:)), keyEquivalent: "")
    world.target = self
    menu.addItem(world)
    let updates = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates(_:)), keyEquivalent: "")
    updates.target = self
    menu.addItem(updates)
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit Autopia", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    item.menu = menu
    statusItem = item
  }

  @objc private func showFace() {
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    hideTrafficLights()
  }

  /** Template glyph: two eyes with punched-out pupils so Light/Dark menu bars both read. */
  private func menuBarEyesImage() -> NSImage {
    let size = NSSize(width: 18, height: 18)
    let image = NSImage(size: size, flipped: false) { _ in
      let eyes = NSBezierPath()
      eyes.appendOval(in: NSRect(x: 0.6, y: 5.0, width: 7.6, height: 8.2))
      eyes.appendOval(in: NSRect(x: 9.8, y: 4.4, width: 7.6, height: 9.2))
      eyes.appendOval(in: NSRect(x: 2.5, y: 6.6, width: 3.3, height: 3.3))
      eyes.appendOval(in: NSRect(x: 11.8, y: 6.3, width: 3.3, height: 3.3))
      eyes.windingRule = .evenOdd
      NSColor.black.setFill()
      eyes.fill()
      return true
    }
    image.isTemplate = true
    return image
  }

  func windowWillResize(_ sender: NSWindow, to frameSize: NSSize) -> NSSize {
    if sender !== window { return frameSize }
    let side = max(180, min(520, min(frameSize.width, frameSize.height)))
    return NSSize(width: side, height: side)
  }

  func windowDidMove(_ notification: Notification) {
    if notification.object as? NSWindow === window { saveFrame() }
  }

  func windowDidResize(_ notification: Notification) {
    if notification.object as? NSWindow === window {
      applyWatchCorner()
      hideTrafficLights()
      saveFrame()
    }
  }

  func windowDidBecomeKey(_ notification: Notification) {
    // A click should make Autopia the active macOS application,
    // even though the window stays above ordinary app windows.
    NSApp.activate(ignoringOtherApps: true)
    hideTrafficLights()
    if notification.object as? NSWindow === window, let web {
      window?.makeFirstResponder(web)
    }
  }

  private func saveFrame() {
    guard let frame = window?.frame else { return }
    UserDefaults.standard.set(NSStringFromRect(frame), forKey: "sphere.face.frame")
  }

  func windowWillClose(_ notification: Notification) {
    if notification.object as? NSWindow === window {
      quitting = true
      worker?.terminate()
      NSApp.terminate(nil)
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationWillTerminate(_ notification: Notification) {
    quitting = true
    web?.configuration.userContentController.removeScriptMessageHandler(forName: "sphere")
    worker?.terminate()
  }

  private func resourcesDir() -> String {
    Bundle.main.resourcePath ?? FileManager.default.currentDirectoryPath
  }

  private func logPath() -> String {
    let logDir = ("~/Library/Logs" as NSString).expandingTildeInPath
    try? FileManager.default.createDirectory(atPath: logDir, withIntermediateDirectories: true)
    return (logDir as NSString).appendingPathComponent("creatures-inc.log")
  }

  private func clearFacePort() {
    let me = ProcessInfo.processInfo.processIdentifier
    var killed = false
    let sweep = Process()
    sweep.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
    sweep.arguments = ["-f", "creatures-worker|sphere-worker|Sphere Node\\.app/"]
    if (try? sweep.run()) != nil {
      sweep.waitUntilExit()
      killed = sweep.terminationStatus == 0
    }
    let lsof = Process()
    let out = Pipe()
    lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    lsof.arguments = ["-ti", "tcp:4101", "-sTCP:LISTEN"]
    lsof.standardOutput = out
    lsof.standardError = FileHandle.nullDevice
    if (try? lsof.run()) != nil {
      lsof.waitUntilExit()
      let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
      for pid in text.split(whereSeparator: \.isNewline).compactMap({ Int32($0) }) where pid != me {
        kill(pid, SIGTERM)
        killed = true
      }
    }
    if killed { Thread.sleep(forTimeInterval: 0.8) }
  }

  private func startWorker() {
    let intel = ProcessInfo.processInfo.hardwareName == "x86_64"
    let exe: String
    var args = ["-i", "-s"]
    if intel {
      exe = (resourcesDir() as NSString).appendingPathComponent("node-x64")
      let script = (resourcesDir() as NSString).appendingPathComponent("creatures-worker.mjs")
      args.append(contentsOf: [exe, script])
    } else {
      exe = (resourcesDir() as NSString).appendingPathComponent("creatures-worker-arm64")
      args.append(exe)
    }
    guard FileManager.default.isExecutableFile(atPath: exe) else {
      showBootFailure(intel ? "Intel Node runtime missing" : "worker binary missing")
      return
    }

    // A worker left behind by an older copy (a crash, a force quit, an update, or the app from
    // when it was still called Sphere Node) keeps port 4101, and the window would load its old
    // face instead of ours.
    clearFacePort()

    let path = logPath()
    if !FileManager.default.fileExists(atPath: path) {
      FileManager.default.createFile(atPath: path, contents: nil)
    }
    let log = FileHandle(forWritingAtPath: path)
    log?.seekToEndOfFile()
    let banner = "\n--- \(Date()) ---\n".data(using: .utf8)
    if let banner { log?.write(banner) }

    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/caffeinate")
    task.arguments = args
    var env = ProcessInfo.processInfo.environment
    env.removeValue(forKey: "SPHERE_PLAIN")
    env.removeValue(forKey: "SPHERE_TUI")
    env["SPHERE_CONFIG"] = (resourcesDir() as NSString).appendingPathComponent("config.json")
    env["SPHERE_FACE_HTML"] = (resourcesDir() as NSString).appendingPathComponent("face.html")
    env["SPHERE_FACE_PORT"] = "4101"
    env["SPHERE_FACE_EMBEDDED"] = "1"
    env["SPHERE_APP_PID"] = String(ProcessInfo.processInfo.processIdentifier)
    task.environment = env
    task.standardOutput = log
    task.standardError = log
    task.terminationHandler = { [weak self] proc in
      guard proc.terminationStatus != 0 else { return }
      DispatchQueue.main.async { self?.workerCrashed() }
    }
    do {
      try task.run()
      worker = task
    } catch {
      showBootFailure(error.localizedDescription)
    }
  }

  /// Bring a crashed worker back, unless it keeps crashing: three times in two minutes shows the failure page.
  private func workerCrashed() {
    guard !quitting else { return }
    let now = Date()
    crashTimes = crashTimes.filter { now.timeIntervalSince($0) < 120 } + [now]
    guard crashTimes.count < 3 else {
      showBootFailure(nil)
      return
    }
    stateTimer?.invalidate()
    loadTimer?.invalidate()
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
      guard let self, !self.quitting else { return }
      self.startWorker()
      self.waitThenLoad()
    }
  }

  private func buildWindow() {
    let size = NSSize(width: 440, height: 440)
    let panel = FaceWindow(
      contentRect: NSRect(origin: .zero, size: size),
      styleMask: [.borderless, .resizable],
      backing: .buffered,
      defer: false
    )
    panel.title = ""
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    panel.titlebarSeparatorStyle = .none
    panel.isMovable = true
    // Must stay off: the page uses `user-select: none`, so WebKit reports the
    // whole page as draggable background and macOS would swallow every click
    // as a window drag (buttons in the face UI would never fire). The
    // DragRegion strip along the top is the intended drag handle.
    panel.isMovableByWindowBackground = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.level = .floating
    panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
    panel.appearance = NSAppearance(named: .darkAqua)
    panel.delegate = self
    panel.setContentSize(size)
    panel.minSize = NSSize(width: 180, height: 180)
    panel.maxSize = NSSize(width: 520, height: 520)
    if let saved = UserDefaults.standard.string(forKey: "sphere.face.frame") {
      let frame = NSRectFromString(saved)
      if (180...520).contains(frame.width), abs(frame.width - frame.height) < 2,
         NSScreen.screens.contains(where: { $0.visibleFrame.intersects(frame) }) {
        panel.setFrame(frame, display: false)
      } else {
        panel.setContentSize(size)
        panel.center()
      }
    } else {
      panel.center()
    }

    let root = NSView(frame: NSRect(origin: .zero, size: size))
    root.wantsLayer = true
    root.layer?.backgroundColor = NSColor.black.cgColor
    root.layer?.masksToBounds = true
    root.layer?.cornerCurve = .continuous
    root.autoresizingMask = [.width, .height]

    let config = WKWebViewConfiguration()
    config.mediaTypesRequiringUserActionForPlayback = []
    config.userContentController.add(self, name: "sphere")
    let hideGate = WKUserScript(
      source: "window.SPHERE_NATIVE_KEY=true;window.WATCH_CORNER=16;",
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    )
    config.userContentController.addUserScript(hideGate)
    let web = FaceWebView(frame: root.bounds, configuration: config)
    web.autoresizingMask = [.width, .height]
    web.wantsLayer = true
    web.layer?.backgroundColor = NSColor.black.cgColor
    web.layer?.cornerCurve = .continuous
    web.layer?.masksToBounds = true
    web.allowsMagnification = false
    root.addSubview(web)

    // Leave the top-left menu and the top-right chat uncovered.
    let dragRegion = DragRegion(
      frame: NSRect(x: 40, y: size.height - 36, width: max(40, size.width - 84), height: 36)
    )
    dragRegion.autoresizingMask = [.width, .minYMargin]
    root.addSubview(dragRegion)

    let bar = makeKeyBar(width: size.width)
    bar.isHidden = true
    root.addSubview(bar)

    panel.contentView = root
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)

    self.window = panel
    self.web = web
    self.keyBar = bar
    self.dragStrip = dragRegion
    applyWatchCorner()
    hideTrafficLights()
    panel.makeFirstResponder(web)
  }

  private func hideTrafficLights() {
    guard let panel = window else { return }
    for kind: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
      if let button = panel.standardWindowButton(kind) {
        button.isHidden = true
        button.isEnabled = false
        button.alphaValue = 0
        button.superview?.isHidden = true
      }
    }
  }

  private func applyWatchCorner() {
    // Keep a 16pt corner on the default watch; shrink it on tiny windows so
    // the shader clip doesn't swallow the face.
    let side = window?.frame.width ?? 440
    let radius: CGFloat = min(16, max(8, side * 0.08))
    let clip: (NSView?) -> Void = { view in
      view?.wantsLayer = true
      view?.layer?.cornerRadius = radius
      view?.layer?.cornerCurve = .continuous
      view?.layer?.masksToBounds = true
    }
    clip(web)
    clip(window?.contentView)
    clip(window?.contentView?.superview)
    window?.invalidateShadow()
    let js = "window.WATCH_CORNER=\(radius);document.documentElement.style.setProperty('--watch-corner','\(radius)px');"
    web?.evaluateJavaScript(js, completionHandler: nil)
  }

  private func makeKeyBar(width: CGFloat) -> NSView {
    let bar = NSView(frame: NSRect(x: 0, y: 0, width: width, height: 118))
    bar.autoresizingMask = [.width, .maxYMargin]
    bar.wantsLayer = true
    bar.layer?.backgroundColor = NSColor.black.cgColor

    let label = NSTextField(labelWithString: "ACCESS CODE")
    label.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    label.textColor = NSColor(white: 0.7, alpha: 1)
    label.alignment = .center
    label.frame = NSRect(x: 24, y: 92, width: width - 48, height: 16)
    label.autoresizingMask = [.width]
    bar.addSubview(label)

    let field = NSTextField(frame: NSRect(x: 24, y: 56, width: width - 48, height: 28))
    field.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    field.alignment = .center
    field.placeholderString = "paste your invite code"
    field.focusRingType = .none
    field.bezelStyle = .roundedBezel
    field.delegate = self
    field.autoresizingMask = [.width]
    bar.addSubview(field)

    let paste = NSButton(frame: NSRect(x: 24, y: 22, width: (width - 56) / 2, height: 26))
    paste.title = "Paste"
    paste.bezelStyle = .rounded
    paste.target = self
    paste.action = #selector(pasteKey)
    paste.autoresizingMask = [.width, .maxXMargin]
    bar.addSubview(paste)

    let join = NSButton(frame: NSRect(x: 32 + (width - 56) / 2, y: 22, width: (width - 56) / 2, height: 26))
    join.title = "Join"
    join.bezelStyle = .rounded
    join.keyEquivalent = "\r"
    join.target = self
    join.action = #selector(submitKey)
    join.autoresizingMask = [.width, .minXMargin]
    bar.addSubview(join)

    let err = NSTextField(labelWithString: "")
    err.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    err.textColor = NSColor(white: 0.85, alpha: 1)
    err.alignment = .center
    err.frame = NSRect(x: 24, y: 4, width: width - 48, height: 16)
    err.autoresizingMask = [.width]
    bar.addSubview(err)

    self.keyField = field
    self.keyError = err
    return bar
  }

  func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
    if control === keyField, commandSelector == #selector(NSResponder.insertNewline(_:)) {
      submitKey()
      return true
    }
    return false
  }

  @objc private func pasteKey() {
    let text = NSPasteboard.general.string(forType: .string) ?? ""
    keyField?.stringValue = text.trimmingCharacters(in: .whitespacesAndNewlines)
    window?.makeKeyAndOrderFront(nil)
    window?.makeFirstResponder(keyField)
  }

  @objc private func submitKey() {
    guard !keyBusy else { return }
    let key = keyField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if key.isEmpty {
      keyError?.stringValue = "enter a code"
      return
    }
    keyBusy = true
    keyError?.stringValue = "checking…"
    var request = URLRequest(url: url.appendingPathComponent("key"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["key": key])
    URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      DispatchQueue.main.async {
        self?.keyBusy = false
        if let error {
          self?.keyError?.stringValue = error.localizedDescription
          return
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = (try? JSONSerialization.jsonObject(with: data ?? Data()) as? [String: Any]) ?? [:]
        if status == 200 {
          self?.keyError?.stringValue = ""
          self?.setKeyBarVisible(false)
          return
        }
        self?.keyError?.stringValue = (body["error"] as? String) ?? "not accepted"
      }
    }.resume()
  }

  private func setKeyBarVisible(_ visible: Bool) {
    guard keyBar?.isHidden == visible else { return }
    keyBar?.isHidden = !visible
    if visible {
      window?.makeKeyAndOrderFront(nil)
      window?.makeFirstResponder(keyField)
    }
  }

  private func waitThenLoad() {
    var tries = 0
    let probe = url.appendingPathComponent("state")
    loadTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] timer in
      guard let self else { return }
      tries += 1
      var request = URLRequest(url: probe)
      request.timeoutInterval = 0.4
      URLSession.shared.dataTask(with: request) { _, response, _ in
        let ok = (response as? HTTPURLResponse)?.statusCode == 200
        if ok || tries > 75 {
          DispatchQueue.main.async {
            timer.invalidate()
            if ok {
              // Old builds were cached heuristically; always fetch the
              // page fresh so app updates actually show their new UI.
              self.web?.load(URLRequest(url: self.url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
              self.startStateWatch()
            } else {
              self.showBootFailure(nil)
            }
          }
        }
      }.resume()
    }
  }

  private func startStateWatch() {
    stateTimer?.invalidate()
    stateTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
      self?.refreshState()
    }
  }

  private func refreshState() {
    var request = URLRequest(url: url.appendingPathComponent("state"))
    request.timeoutInterval = 0.8
    URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
      guard (response as? HTTPURLResponse)?.statusCode == 200,
            let data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
      let phase = json["phase"] as? String ?? ""
      DispatchQueue.main.async {
        self?.lastState = json
        self?.setKeyBarVisible(phase == "key")
      }
    }.resume()
  }

  private func showBootFailure(_ message: String?) {
    let tail: String
    if let message, !message.isEmpty {
      tail = message
    } else if let data = try? Data(contentsOf: URL(fileURLWithPath: logPath())),
              let text = String(data: data, encoding: .utf8) {
      let lines = text.split(separator: "\n").suffix(8).joined(separator: "\n")
      tail = lines.isEmpty ? "worker exited" : lines
    } else {
      tail = "worker exited"
    }
    let escaped = tail
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
    let html = """
    <html><body style="background:#000;color:#e8e8e8;font:12px/1.4 ui-monospace,monospace;display:flex;align-items:center;justify-content:center;height:100%;margin:0;padding:24px;white-space:pre-wrap;text-align:center">
    could not start this node\n\n\(escaped)
    </body></html>
    """
    web?.loadHTMLString(html, baseURL: nil)
    setKeyBarVisible(false)
  }
}

extension ProcessInfo {
  var hardwareName: String {
    var sysinfo = utsname()
    uname(&sysinfo)
    return withUnsafePointer(to: &sysinfo.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
  }
}

@main
enum AutopiaApp {
  static func main() {
    // The menu bar uses the process name, which otherwise stays the executable's old name.
    ProcessInfo.processInfo.processName = "Autopia"
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.delegate = AppDelegate.shared
    app.run()
  }
}
