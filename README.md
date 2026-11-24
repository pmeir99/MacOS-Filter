# MacOS Filter

A local image filter for Chrome on macOS, designed for Apple Silicon Macs with 16 GB unified memory. The product pairs a SwiftUI settings app, a Chrome Manifest V3 extension, and a Swift native-messaging host. Images stay on the Mac.

## Chosen path

The extension discovers page images and preserves their layout while filtering. The native host runs Apple Vision/Core ML providers and returns decisions and compact masks. The app owns settings and connects Chrome to the host. This keeps image access in the browser and inference in native code without a remote service or local network server.

## Current working foundation

- Entire-image cover and cover-all-detected-people modes.
- Solid or blur overlay, with color and opacity settings.
- Apple Vision person segmentation; no separately downloaded model files are currently bundled.
- A local browser-to-host connection and race-to-first-compatible-macOS-runner build workflow.

The current Vision provider does not classify nudity, skin, clothing, apparent gender, or modesty levels. Those controls stay hidden until a model is integrated and evaluated. OpenNSFW2, NudeNet, MediaPipe, YOLO, and SAM options are compared in the guide; they are not all installed or active.

## Guides

- [Product and engineering guide](docs/PRODUCT-GUIDE.md): product requirements, interception decision, provider comparison, categories, policy rules, rendering, privacy, and roadmap.
- [Model options](docs/MODEL-OPTIONS.md): model-specific comparison and capability limits.
- [Build and install](docs/BUILDING.md): prerequisites, setup, and Gatekeeper troubleshooting.

The current extension filters supported HTML image elements. CSS backgrounds, canvas, video, and unsupported browser surfaces are not yet covered. Chrome has no general API that pauses page rendering until model inference finishes.
