# MacOS Filter — product and engineering guide

## Goal and boundaries

Build a private, fully on-device image filter for Chrome on Apple Silicon Macs with 16 GB unified memory, targeting M4 and later. Begin with images in Chrome. Consider Safari after Chrome is dependable. Video and other applications are out of scope for the first product.

Let the user choose an Orthodox Jewish standard and severity policy. The software should report observable visual evidence and confidence. It cannot know a person's actual identity, intent, or gender from an image. Any future “male/female” option must be described as a visual-presentation estimate and shown only if a provider can associate the estimate with the correct person reliably.

## One chosen architecture

Build a SwiftUI macOS app, a Chrome Manifest V3 extension, and a bundled Swift native-messaging host.

- The **Chrome extension** discovers supported image elements, gates visibility while a decision is pending, and draws overlays in the original element's box.
- The **SwiftUI app** owns user policy, settings, model configuration, connection setup, and diagnostics. Use SwiftUI and AppKit; UIKit is for iOS, not macOS.
- The **native host** receives bounded image bytes from Chrome, safely decodes and normalizes them, runs local inference, and returns a compact action and optional mask.
- A **provider interface** declares real capabilities: image classification, person instances, person masks, skin masks, and body-part labels. Only show controls backed by capabilities.
- Keep all inference on the Mac. Do not send images to a server or save page images to disk by default.

Use Chrome Native Messaging for extension-to-app communication. It avoids an app-hosted network listener, firewall prompts, and an extra local server. Chrome documents a 64 MiB browser-to-host message maximum and a 1 MiB host-to-browser maximum, so return small decisions and compact/downsampled masks rather than full images. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

## Interception: what is possible

| Method | Strength | Limit | Decision |
| --- | --- | --- | --- |
| DOM image elements | Knows what is visible and where it belongs; can preserve geometry | Must handle responsive, lazy, and dynamically inserted images; other drawing methods are separate work | Core path |
| Chrome network hooks | May observe or block requests | Does not give a universal decoded-pixel prepaint gate or the final crop/DOM layout | Not the classifier |
| Local HTTP/HTTPS proxy | Can inspect requests | HTTPS interception requires a trusted local certificate; can disrupt pinning, HTTP/3, caching, and privacy; does not know rendered crop/layout | Reject for v1 |
| Full-page scan | Can find nodes missed during incremental discovery | Browser has no general API to pause all page rendering until a model finishes | Use as a reconciliation pass, not a prepaint guarantee |
| Early content script and CSS | Can install a visibility gate before page DOM construction | Cannot cover every browser surface or all custom rendering paths | Use for supported image elements |

Chrome's document_start injection occurs before the page DOM is constructed, which allows an early gate. It does not make inference instantaneous. There is no general hook to classify every image exactly 0.5 ms before it appears. [Chrome content-script timing](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

For supported images, keep the pixels invisible while preserving the original layout box. Analyze each image asynchronously. Reveal the image on an allow decision; show the aligned mask on a block decision. Watch for image source changes and new DOM nodes. Add CSS backgrounds, SVG, canvas, shadow roots, cross-origin frames, and other media only when each source can be obtained and tested. Explain browser-internal pages and unsupported content in diagnostics.

## Decision and inference pipeline

Classification determines what may be present; segmentation determines which pixels to cover. Keep these outputs separate.

1. Enforce byte, dimension, and pixel limits. Decode safely, normalize EXIF orientation and color space, and hash the image.
2. Reuse cached results only when the image hash, model version, and relevant policy match.
3. Run a fast image-level classifier for coarse severity.
4. When the rule requires people or pixels, run a person-instance or body-region segmenter.
5. Apply per-label confidence thresholds and the user's action rules.
6. Return allow, cover whole image, cover people, cover selected pixels, or a configured fail-closed result.
7. Log local reason codes and timings only; never log source images.

Prioritize visible and near-visible content, deduplicate identical images, cancel work for removed nodes, keep model processes warm, and limit concurrent decode/inference work. Do not try to max every core at once. A bounded queue, sensible memory budget, and short visible-image latency are better than saturating the CPU and starving Chrome.

### Apple compute

- Keep Apple Vision person segmentation as the native baseline.
- For new models, prefer Core ML with compute units set to all. Apple says this allows the OS to choose supported compute units, including Neural Engine; it does not guarantee that every model uses every accelerator. [Core ML compute units](https://developer.apple.com/documentation/coreml/mlcomputeunits/all)
- Vision schedules its own work. Do not promise a specific accelerator unless measured or exposed by the API.
- Use Accelerate or vImage for image/mask transforms only where profiling proves useful.
- Run inference off the UI thread and measure the actual M4/16 GB Mac: cold and warm P50/P95 latency, memory, energy, mask alignment, false negatives, false positives, and delay before pixels are revealed.

## Model comparison and recommendation

| Model/path | Useful output | What it cannot do alone | Suggested role |
| --- | --- | --- | --- |
| Apple Vision person segmentation | Person-shaped matte; no separate model download | No nudity, clothing, skin, gender, or modesty labels | Keep as baseline for cover-all-people |
| OpenNSFW2 | Pretrained porn probability | Not a seven-band modesty score and no pixel locations; Keras/TensorFlow runtime is not ideal for a native bundle | Benchmark as a coarse explicit-content classifier; consider Core ML export only if outputs match |
| NudeNet | Face and exposed/covered body-part detections | Boxes are not precise skin masks and do not make seven reliable categories; AGPL-3.0 license | Isolated evaluation only unless licensing is resolved |
| MediaPipe Image Segmenter | Depending on model asset, person/background or hair, face, skin, clothing, and accessory masks | Segment labels are not an NSFW/modesty classifier; exact model quality, speed, macOS path, and redistribution terms need testing | Strong candidate for skin/clothing masks |
| YOLOv8 / Ultralytics | General detection, segmentation, classification, pose | General classes do not automatically mean modesty categories; AGPL-3.0 default license | Not first choice without a relevant model and license decision |
| SAM 3 | Prompt-driven object masks | Segmentation does not classify exposure; model assets/runtime/license need review | Optional later mask provider only |

Sources: [OpenNSFW2](https://github.com/bhky/opennsfw2), [NudeNet](https://github.com/notAI-tech/NudeNet), [MediaPipe Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter), [Ultralytics licensing](https://github.com/ultralytics/ultralytics), [SAM 3 license](https://github.com/facebookresearch/sam3/blob/main/LICENSE).

Recommended evaluation: keep Vision; benchmark OpenNSFW2 for coarse explicit-content routing; benchmark MediaPipe's skin/clothing model for pixel masks. Evaluate on a private, manually reviewed corpus on the actual Mac. Use classifier output to decide severity and segmenter output to locate pixels. Do not simple-majority-vote models. If confidence is low or outputs disagree, follow the user's configured fallback, such as a full-image cover. Add a second detector only if it measurably reduces misses enough to justify added latency and memory.

No candidate listed here should be assumed to reliably produce all seven requested levels. Do not expose those controls until evaluation proves the model can support them.

## Categories and user rules

Keep visual tags separate from policy. A provider may estimate explicit activity, exposed intimate anatomy, underwear/lingerie, swimwear/bare torso, skin area, garment coverage, and confidence. The user decides which tags trigger which action.

Use this as a draft test vocabulary:

1. **Explicit sexual activity:** sexual acts or explicit sexual contact.
2. **Explicit nudity:** exposed genitals, anus, buttocks, or breasts.
3. **Underwear or lingerie:** underwear, lingerie, or implied nudity; sexualized framing can be a separate tag.
4. **Swimwear or bare torso:** swimwear, bare torso, or substantial exposed skin; beach/pool context is an independent optional tag.
5. **Noticeable exposure:** shoulders, upper arms, midriff, or thighs/knees visible.
6. **Everyday covered clothing:** body covered except user-exempted areas such as face, neck, or hands.
7. **Full loose coverage:** long sleeves, high neckline, covered legs, and loose fit.

Treat garment type, fit, pose, exposure, and context as separate measurable tags. Let the user select exemptions and thresholds. A conservative default can be offered, but don't claim there is one rule set followed identically by all Orthodox Jewish users. “Custom” should mean rules over real provider outputs, not a custom-trained classifier that does not exist. Apparent male/female controls must mean visual-presentation estimates, not actual identity.

## Paint and preserve layout

Keep the source image element in place. Add an overlay anchored to the same element box, then recalculate it after scroll, resize, zoom, source change, or layout shift. Account for object-fit, object-position, EXIF orientation, device-pixel ratio, and crop. Never scale a model mask blindly over a cropped image.

Offer a solid color, strong blur, and optionally pixelation. For high severity, default to opaque solid cover: blur and pixelation can leave recognizable details. Feather a segmentation edge only when it does not leak useful detail. Do not use generated inpainting as the safety baseline. It can invent content, costs more compute, and can miss the target. Deterministic overlays are faster and easier to verify. If generative fill is ever tested, keep it local and optional, label it clearly, and retain an opaque fallback.

An image waiting for analysis may be visually hidden while its original width, height, margins, and aspect ratio remain intact. This avoids shifting page layout. Do not replace it with a smaller placeholder.

## UI

The Mac app should be a compact native SwiftUI settings window with connection status, filtering policy, rendering, provider/model status, and diagnostics. Put confidence thresholds and fallback behavior in Advanced settings. The Chrome popup should have one clear on/off control, connection status, and a link to open Mac settings; it should not duplicate the full rule editor. Use system typography and controls.

## Privacy and quality gates

- Keep images and masks in memory. No remote inference or telemetry by default. Never put images in logs or crash reports.
- Explain broad website permission before requesting it. Filtering remains off until the user enables it.
- Bound native-message sizes and memory. Fail closed or abstain according to policy on decode, host, or model errors.
- Maintain a private, human-reviewed evaluation set. Report category-level false negatives and false positives; never learn implicitly from browsing.
- Test cross-origin CDNs, redirects, srcset, lazy loading, GIF first-frame behavior, dynamic DOM, source swaps, frames, shadow DOM, backgrounds, SVG, canvas, zoom, layout changes, mask mapping, settings changes, app restarts, and unsupported pages.
- CI should run Swift and extension tests, verify signatures and archives, and package the app. A real macOS install/launch/native-messaging smoke test is separate from unit tests. Model accuracy and M4 performance need their own report.
- Add a mode only after its provider declares the capability, the UI describes its limits, and tests cover fallback behavior and quality.

## Stages

1. **Foundation:** make the app launch reliably; verify Chrome-host connection; preserve geometry for full-image and all-person covers.
2. **Early coverage:** robustly handle responsive, lazy, and dynamic HTML images; add clear diagnostics for uncovered surfaces.
3. **Model bake-off:** benchmark classifier and skin/clothing segmenter on M4/16 GB; assess license, latency, memory, and false negatives.
4. **Rules:** expose only measured evidence and actions; add configurable thresholds and severity routing.
5. **Refinement:** caching, UI, performance, CSS backgrounds, then Safari. Safari Web Extensions can share web code, but packaging and distribution use Apple's extension/app process. [Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)

