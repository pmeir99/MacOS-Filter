# Build and install

## Architecture

Chrome discovers images and draws overlays. The Mac app stores settings and installs a Chrome Native Messaging manifest. Chrome launches the bundled FilterHost and holds a persistent local pipe open while filtering is enabled. The host uses Vision on this Mac and returns a compact PNG mask. Image bytes are not sent to a server or written to disk by this project.

The Swift provider protocol isolates segmentation from the browser protocol. The first provider uses Vision person segmentation. Future Core ML providers should use MLModelConfiguration.computeUnits = .all so Core ML can select available CPU, GPU, and Neural Engine execution for a supported model. This is a request to the OS, not a guarantee that every model runs on every accelerator. The extension itself only handles page access and overlays; it does not duplicate the model in JavaScript.

macOS uses SwiftUI and AppKit. UIKit is not a macOS framework. The app is designed for macOS 12 and later; an Apple Core AI/SAM 3 provider would be an optional path for supported macOS 27 systems, not a dependency of the baseline.

## Local prerequisites

- macOS 12 or newer
- Xcode command line tools and Swift 5.9+
- Chrome 116 or newer
- Node.js 20 or newer for extension checks

Build and test:

    swift test -Xswiftc -warnings-as-errors
    npm --prefix extension run check
    npm --prefix extension test
    bash scripts/package-app.sh

## Install for development

1. Build and launch the app package from dist.
2. Open chrome://extensions, enable Developer mode, choose Load unpacked, and select the extension directory.
3. Copy the extension ID from its detail card.
4. Paste the ID into the app and choose Save Settings and Connect.
5. Reload the extension. Open its popup and enable filtering.

Chrome asks for access to all websites when filtering is enabled. This permits the extension service worker to read images from cross-origin image CDNs. The popup explains the permission before requesting it. Filtering is off until the user enables it.

## Current behavior

The first release supports covering the entire image or the person masks Vision detects. Blur, overlay color, and opacity are rendering options. The host fails closed by covering an image if it cannot analyze it or returns no person mask.

Skin-only, selective body parts, apparent male/female filtering, custom rules, and the seven example modesty levels are not exposed by the baseline Vision provider. Those require different model capabilities and an evaluation set. “Male/female” can only mean a model's visual presentation label, not a person's identity or gender. Model choice and confidence thresholds must be explicit before those rules are enabled.

## Performance and quality

The extension batches no images into a cloud call. Native host input is limited to 8 MiB and 24 megapixels; oversized, invalid, or unsupported images are covered in full. Mask results are capped below Chrome's native-host response limit. Vision runs in the native process and uses the operating system's inference scheduling. Keep the host port open so the provider can remain warm during browsing.

The build workflow checks JavaScript syntax, runs browser-helper tests, runs Swift protocol tests with compiler warnings treated as errors, builds both Swift executables, and packages the app and extension. Model-specific evaluation must measure false negatives, false positives, latency, and mask alignment before a new provider's controls are shown.
