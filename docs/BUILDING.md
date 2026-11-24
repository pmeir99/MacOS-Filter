# Build and install

## Architecture

Chrome discovers HTML image elements and renders overlays. The Mac app stores settings and installs a Chrome Native Messaging manifest. Chrome launches the bundled FilterHost and keeps a local pipe open while filtering is enabled. FilterHost uses Vision on this Mac and returns a compact PNG mask. Image bytes are not sent to a server or written to disk by this project.

The Swift segmentation-provider boundary isolates inference from the extension protocol. The first provider uses Vision person segmentation. Future Core ML providers should request all available compute units so macOS can choose CPU, GPU, or Neural Engine execution supported by the model. This is a request to the OS, not a promise that every model runs on every accelerator. The extension handles discovery and drawing; it does not duplicate model inference in JavaScript.

macOS uses SwiftUI and AppKit. UIKit is not a macOS framework. The baseline app targets macOS 13 and later.

## Local prerequisites

- macOS 13 or newer
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

The first release supports covering the entire image or the mask for all people Vision detects. Blur, overlay color, and opacity are rendering options. The host covers the whole image if analysis fails, image limits are exceeded, or no person mask is returned.

Skin-only, selective body parts, apparent male/female filtering, custom rules, and the seven example modesty levels are not exposed by the baseline Vision provider. Those require different model capabilities and an evaluation set. “Male/female” can only mean a model's visual-presentation label, not a person's identity or gender. See MODEL-OPTIONS.md.

## Performance and quality

The extension sends no images to a cloud service. Native-host input is limited to 8 MiB and 24 megapixels; oversized, invalid, or unsupported images are covered in full. Mask responses are capped below Chrome's native-host response limit. Vision runs in the native process with CPU-only execution disabled. Keep the native messaging connection open while filtering so the host remains available.

The build workflow checks JavaScript syntax, runs browser-helper tests, runs Swift protocol tests with compiler warnings treated as errors, builds both Swift executables, and packages the app and extension. Model-specific evaluation must measure false negatives, false positives, latency, and mask alignment before a provider's controls are shown.
