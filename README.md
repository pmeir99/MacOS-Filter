# MacOS-Filter

On-device image filtering for Chrome on macOS. The project pairs a small SwiftUI setup app and a Chrome Manifest V3 extension with a local Swift native-messaging host. Images and masks stay on the Mac.

## One build path

1. The extension observes images on a site the user has enabled.
2. It requests an image mask from the local native host using Chrome Native Messaging.
3. The host validates and decodes the image, calls the configured segmentation provider, and returns a small mask.
4. The extension draws a configurable overlay over the original image. The original image is never uploaded to a service.
5. The SwiftUI app manages filtering preferences and registers the host manifest for the extension ID.

The extension owns browser-page discovery and rendering. Swift owns model execution and installation. A versioned JSON protocol keeps the browser side independent of the model framework.

## Model strategy

The first provider is Vision person segmentation. It is included with macOS, runs locally, and returns a person matte. It is a good baseline for covering the whole image or the detected person without downloading a model.

The `SegmentationProvider` boundary is intended to support additional providers:

- Core ML model packages for specialist classes or body-part parsing.
- Apple Core AI image segmentation, including SAM 3, as an opt-in larger model on supported macOS versions. Apple documents a 623 MB SAM 3 asset targeting macOS 27. It must be downloaded on demand and evaluated for latency and mask quality before being exposed as a production option.

A provider must report its capabilities. The app and extension must not show controls that the active provider cannot perform. Vision person segmentation does not identify semantic body parts such as face, hands, or clothing; those controls require a tested body-part model.

## Initial filtering modes

- Entire image: cover the full image without inference.
- People: cover the detected person mask.
- Overlay style, color, opacity, and edge expansion or softening are presentation settings.
- If inference fails or the provider cannot satisfy a selected rule, the extension covers the entire image and shows an actionable status instead of silently showing the unfiltered image.

Videos and APK inspection are out of scope.

## Quality bar

- Validate native-message framing, message lengths, image type, and decoded dimensions.
- Keep native host standard output protocol-only; write diagnostics to standard error.
- Limit image bytes and pixel dimensions before inference.
- Test provider capability handling, no-person images, malformed requests, mask response sizing, and browser overlay behavior.
- Run Swift tests and package the macOS app on compatible Apple runners. Check extension JavaScript and run its Node test suite on every build.

## Development

See [docs/BUILDING.md](docs/BUILDING.md) for the project layout, local installation, browser permissions, and CI workflow. The app and extension are under active development; the repository does not yet contain a downloadable release.
