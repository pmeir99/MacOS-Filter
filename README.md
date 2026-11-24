# MacOS-Filter

On-device image filtering for Chrome on macOS. The project pairs a SwiftUI settings app, a Chrome Manifest V3 extension, and a local Swift native-messaging host. Images and masks stay on the Mac.

## Chosen build path

Chrome discovers image elements and draws the overlay. The Swift app stores settings and registers the native host. The extension sends image bytes over Chrome Native Messaging; the host uses Apple Vision and returns a compact mask. This keeps browser-side code independent from model providers while leaving inference in native Apple frameworks.

The current first modes are full-image cover and cover-all-detected-people. The baseline provider is Apple Vision person segmentation. The image pipeline and provider capability boundary are designed for optional Core ML and Core AI providers, which can add skin, body-region, exposure, and visual-presentation outputs later.

## Hardware and privacy

The extension handles page access, permissions, and rendering. The local Swift host handles inference. Vision uses macOS image-analysis services and is not forced into CPU-only mode. Future Core ML providers should request all supported compute units; macOS may schedule work on CPU, GPU, or Neural Engine depending on the model and hardware. The extension does not ship a second model runtime or upload images.

The extension is off until enabled. Enabling it requires granting Chrome access to websites and their images, including cross-origin CDNs. Input images are held in memory, capped at 8 MiB and 24 megapixels, and not written to disk by this project.

## Model options and current limits

See [docs/MODEL-OPTIONS.md](docs/MODEL-OPTIONS.md) for the comparison. Vision returns a person matte only. It does not classify modesty levels, exposed skin, clothing, or apparent gender. The app does not show unsupported controls.

Model outputs can miss people or body regions. This initial implementation covers the entire image when the host errors, the image exceeds limits, or no person mask is returned. Full-image mode does not need inference.

Videos and APK inspection are out of scope. The extension currently filters HTML image elements, not CSS background images.

## Quality checks

The repository has native-protocol unit tests and extension helper tests for input normalization, fail-closed behavior, URL validation, and mask alignment. The macOS GitHub workflow checks extension syntax, runs tests with compiler warnings as errors, builds the app and host, packages both, and verifies the archives.

See [docs/BUILDING.md](docs/BUILDING.md) for setup and [docs/MODEL-OPTIONS.md](docs/MODEL-OPTIONS.md) for the model path.
