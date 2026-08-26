import AppKit

@main
struct PunksPromotionHarness {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        application.terminate(nil)
    }
}
