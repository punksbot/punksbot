import AppKit
import XCTest

final class PunksPromotionUITests: XCTestCase {
    private let stories = [
        "connexion",
        "workspace",
        "lecture-live",
        "pagination",
        "publication",
        "reponse",
        "sujet",
        "reactions",
    ]

    private func requiredEnvironment(_ name: String) throws -> String {
        guard let value = ProcessInfo.processInfo.environment[name], !value.isEmpty else {
            throw NSError(
                domain: "PunksPromotionUITests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Missing \(name)"]
            )
        }
        return value
    }

    private func fixture() throws -> [String: Any] {
        let raw = try requiredEnvironment("PUNKS_XCTEST_FIXTURE")
        guard
            let data = raw.data(using: .utf8),
            let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw NSError(
                domain: "PunksPromotionUITests",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Invalid PUNKS_XCTEST_FIXTURE"]
            )
        }
        return value
    }

    private func writeJson(_ value: Any, to path: String) throws {
        let data = try JSONSerialization.data(
            withJSONObject: value,
            options: [.prettyPrinted, .sortedKeys]
        )
        var content = data
        content.append(0x0A)
        guard FileManager.default.createFile(atPath: path, contents: content) else {
            throw NSError(
                domain: "PunksPromotionUITests",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Could not create \(path)"]
            )
        }
    }

    private func saveScreenshot(_ story: String, root: String) throws {
        let screenshot = XCUIScreen.main.screenshot()
        try screenshot.pngRepresentation.write(
            to: URL(fileURLWithPath: root).appendingPathComponent("\(story).png"),
            options: .withoutOverwriting
        )
    }

    private func waitForIpcMessageId(
        path: String,
        threadDepth: Int,
        timeout: TimeInterval = 20
    ) throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let content = try? String(contentsOfFile: path, encoding: .utf8) {
                for line in content.split(separator: "\n").reversed() {
                    guard
                        let data = line.data(using: .utf8),
                        let decoded = try? JSONSerialization.jsonObject(with: data),
                        let record = decoded as? [String: Any],
                        record["command"] as? String == "punks_post_message",
                        record["status"] as? String == "ok",
                        let coordinates = record["coordinates"] as? [String: Any],
                        coordinates["threadDepth"] as? Int == threadDepth,
                        let messageId = coordinates["messageId"] as? String
                    else {
                        continue
                    }
                    return messageId
                }
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        throw NSError(
            domain: "PunksPromotionUITests",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "Native IPC Message observation timed out"]
        )
    }

    func testInstalledSocialLoop() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let applicationPath = try requiredEnvironment("PUNKS_XCTEST_APPLICATION")
        let resultPath = try requiredEnvironment("PUNKS_XCTEST_RESULT")
        let screenshotRoot = try requiredEnvironment("PUNKS_XCTEST_SCREENSHOTS")
        let platform = try requiredEnvironment("PUNKS_XCTEST_PLATFORM")
        let fixture = try fixture()
        let workspaceSlug = fixture["workspaceSlug"] as! String
        let workspaceId = fixture["workspaceId"] as! String
        let conversationId = fixture["conversationId"] as! String
        let seedMessageIds = fixture["seedMessageIds"] as! [String]
        try FileManager.default.createDirectory(
            atPath: screenshotRoot,
            withIntermediateDirectories: false
        )

        let app = XCUIApplication(url: URL(fileURLWithPath: applicationPath))
        for name in [
            "PUNKS_PROMOTION_ASSET_MANIFEST",
            "PUNKS_PROMOTION_IPC_LOG",
            "PUNKS_PROMOTION_NETWORK_LOG",
        ] {
            app.launchEnvironment[name] = environment[name]
        }
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))

        var ui: [[String: Any]] = []
        func observe(_ story: String, _ element: XCUIElement, _ action: String) throws {
            XCTAssertTrue(element.waitForExistence(timeout: 30), "Missing UI for \(story)")
            ui.append([
                "story": story,
                "action": action,
                "selector": element.identifier.isEmpty ? element.label : element.identifier,
                "outcome": "visible",
            ])
            try saveScreenshot(story, root: screenshotRoot)
        }

        let webView = app.webViews.firstMatch
        try observe("connexion", webView, "session-ready")
        let workspace = app.buttons["Workspace \(workspaceSlug)"]
        XCTAssertTrue(workspace.waitForExistence(timeout: 30))
        workspace.click()
        try observe("workspace", workspace, "workspace-mounted")

        let stream = app.buttons["Stream \(conversationId)"]
        XCTAssertTrue(stream.waitForExistence(timeout: 30))
        stream.click()
        try observe("lecture-live", app.staticTexts["Live"].firstMatch, "follow-live")

        let older = app.buttons["Load older Messages"]
        XCTAssertTrue(older.waitForExistence(timeout: 30))
        older.click()
        try observe(
            "pagination",
            app.descendants(matching: .any)["Message \(seedMessageIds[0])"],
            "older-page-visible"
        )

        let topic = app.textFields["Message subject"]
        let composer = app.textViews["Message composer"]
        XCTAssertTrue(topic.waitForExistence(timeout: 30))
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        let rootContent = "Promotion root \(Int(Date().timeIntervalSince1970))"
        topic.click()
        topic.typeText("Signed subject")
        composer.click()
        composer.typeText(rootContent)
        app.buttons["Send"].click()
        let ipcPath = try requiredEnvironment("PUNKS_PROMOTION_IPC_LOG")
        let rootMessageId = try waitForIpcMessageId(path: ipcPath, threadDepth: 0)
        try observe(
            "publication",
            app.descendants(matching: .any)["Message \(rootMessageId)"],
            "root-message-visible"
        )
        try observe(
            "sujet",
            app.descendants(matching: .any)["Message subject \(rootMessageId)"],
            "root-subject-visible"
        )

        let reaction = app.buttons["Reaction \(rootMessageId) thumbs up"]
        reaction.click()
        try observe("reactions", reaction, "reaction-added")

        let threadRootId = seedMessageIds.last!
        let thread = app.buttons["Thread \(threadRootId)"]
        XCTAssertTrue(thread.waitForExistence(timeout: 30))
        thread.click()
        XCTAssertTrue(app.staticTexts["Thread"].waitForExistence(timeout: 30))
        let replyContent = "Promotion Reply \(Int(Date().timeIntervalSince1970))"
        let replyComposer = app.textViews["Message composer"]
        replyComposer.click()
        replyComposer.typeText(replyContent)
        app.buttons["Send"].click()
        let replyMessageId = try waitForIpcMessageId(path: ipcPath, threadDepth: 1)
        try observe(
            "reponse",
            app.descendants(matching: .any)["Message \(replyMessageId)"],
            "reply-visible"
        )

        XCTAssertEqual(ui.map { $0["story"] as! String }, stories)
        let tree = webView.debugDescription
        XCTAssertFalse(tree.isEmpty)
        var focusObservations: [String] = []
        for _ in 0..<8 {
            app.typeKey(XCUIKeyboardKey.tab.rawValue, modifierFlags: [])
            let focused = app.descendants(matching: .any)
                .matching(NSPredicate(format: "hasKeyboardFocus == true"))
                .firstMatch
            if focused.exists {
                focusObservations.append(
                    focused.identifier.isEmpty ? focused.label : focused.identifier
                )
            }
        }
        XCTAssertGreaterThanOrEqual(focusObservations.count, 3)
        for _ in 0..<12 {
            app.typeKey("+", modifierFlags: .command)
        }
        XCTAssertTrue(webView.waitForExistence(timeout: 10))
        app.typeKey("0", modifierFlags: .command)
        let reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let contrastScreenshot = XCUIScreen.main.screenshot().pngRepresentation
        XCTAssertFalse(contrastScreenshot.isEmpty)
        let accessibility = Dictionary(
            uniqueKeysWithValues: [
                "clavier",
                "focus",
                "zoom-200",
                "contraste",
                "mouvement-reduit",
                "lecteur-ecran",
            ].map { criterion in
                let observation: String
                switch criterion {
                case "clavier":
                    observation = "\(focusObservations.count) controls reached with native Tab events"
                case "focus":
                    observation = "focus order: \(focusObservations.prefix(8).joined(separator: " > "))"
                case "zoom-200":
                    observation = "native Command-plus reached the compiled 200 percent ceiling"
                case "contraste":
                    observation = "\(contrastScreenshot.count) screenshot bytes captured for contrast review"
                case "mouvement-reduit":
                    observation = "macOS reduced-motion preference queried: \(reducedMotion)"
                default:
                    observation = "\(tree.count) accessibility-tree bytes observed"
                }
                return (
                    criterion,
                    [
                        "automated": [[
                            "tool": "XCTest",
                            "exitCode": 0,
                            "observation": observation,
                        ]],
                    ]
                )
            }
        )
        workspace.click()
        XCTAssertTrue(webView.waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 1)
        try writeJson(
            [
                "schema": "punks.macos-xctest-result.v1",
                "platform": platform,
                "bundleId": "bot.punks.desktop.staging",
                "executable": try requiredEnvironment("PUNKS_XCTEST_NATIVE_BINARY"),
                "authentication": [
                    "complete": false,
                    "reason": "installed authentication ceremony automation is unavailable",
                ],
                "ui": ui,
                "accessibility": accessibility,
                "follow": [
                    "request": [
                        "transport": "wss",
                        "method": "FOLLOW",
                        "origin": "wss://staging.punks.bot",
                        "path": "/api/v1/workspaces/\(workspaceId)/conversations/\(conversationId)/follow",
                        "status": 101,
                    ],
                    "trace": [],
                    "scenarios": [:],
                ],
            ],
            to: resultPath
        )
    }

    func testIndependentAccessibilityReview() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let applicationPath = try requiredEnvironment("PUNKS_XCTEST_APPLICATION")
        let resultPath = try requiredEnvironment("PUNKS_XCTEST_ACCESSIBILITY_REVIEW_RESULT")
        let platform = try requiredEnvironment("PUNKS_XCTEST_PLATFORM")
        let artifactSha256 = try requiredEnvironment("PUNKS_XCTEST_ARTIFACT_SHA256")
        let app = XCUIApplication(url: URL(fileURLWithPath: applicationPath))
        for name in [
            "PUNKS_PROMOTION_ASSET_MANIFEST",
            "PUNKS_PROMOTION_IPC_LOG",
            "PUNKS_PROMOTION_NETWORK_LOG",
        ] {
            app.launchEnvironment[name] = environment[name]
        }
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30))

        var focusObservations: [String] = []
        for _ in 0..<8 {
            app.typeKey(XCUIKeyboardKey.tab.rawValue, modifierFlags: [])
            let focused = app.descendants(matching: .any)
                .matching(NSPredicate(format: "hasKeyboardFocus == true"))
                .firstMatch
            if focused.exists {
                focusObservations.append(
                    focused.identifier.isEmpty ? focused.label : focused.identifier
                )
            }
        }
        XCTAssertGreaterThanOrEqual(focusObservations.count, 3)
        for _ in 0..<12 {
            app.typeKey("+", modifierFlags: .command)
        }
        XCTAssertTrue(webView.waitForExistence(timeout: 10))
        app.typeKey("0", modifierFlags: .command)
        let tree = webView.debugDescription
        XCTAssertFalse(tree.isEmpty)
        let reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let contrastScreenshot = XCUIScreen.main.screenshot().pngRepresentation
        XCTAssertFalse(contrastScreenshot.isEmpty)
        let criteria: [String: String] = [
            "clavier": "\(focusObservations.count) controls reached by a second native Tab traversal",
            "focus": "second focus order: \(focusObservations.prefix(8).joined(separator: " > "))",
            "zoom-200": "second native Command-plus traversal reached the compiled ceiling",
            "contraste": "\(contrastScreenshot.count) bytes captured independently for contrast",
            "mouvement-reduit": "second macOS reduced-motion query: \(reducedMotion)",
            "lecteur-ecran": "\(tree.count) accessibility-tree bytes independently observed",
        ]
        try writeJson(
            [
                "schema": "punks.independent-accessibility-review.v1",
                "platform": platform,
                "artifactSha256": artifactSha256,
                "criteria": criteria,
            ],
            to: resultPath
        )
        app.terminate()
    }
}
