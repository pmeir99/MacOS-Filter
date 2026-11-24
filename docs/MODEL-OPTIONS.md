# Model options and capability map

Classification says what may be in an image; segmentation says which pixels to cover. They are separate jobs and often need separate providers.

| Candidate | Classification | Pixel masks | Local macOS path | Key limitation |
| --- | --- | --- | --- | --- |
| DeepLabV3 FP16 | PASCAL VOC pixel classes | Person-class silhouette | Bundled Core ML model from Apple | Small or obscured people can be missed |
| Apple Vision person segmentation | None | Person silhouette | Built into macOS Vision | Does not classify skin, clothing, nudity, or modesty |
| OpenNSFW2 | Porn probability | None | Evaluate export to Core ML | Porn-focused binary probability; no seven bands or body location |
| NudeNet | Exposed/covered body-part and face detections | Bounding boxes | ONNX runtime or convert/test | Not pixel masks; AGPL-3.0 license |
| MediaPipe Image Segmenter | None | Model-dependent person, hair, face, skin, clothing labels | MediaPipe Tasks Vision or model conversion | Model-specific quality/runtime; not modesty classification |
| YOLOv8 / Ultralytics | Depends on weights | Boxes, instance masks, pose, classes | Convertable models or runtime | Generic detector is not a modesty model; AGPL-3.0 default licensing |
| SAM 3 | Prompt-conditioned object masks | Prompted regions | Separate model/runtime | Segmenter, not classifier; model licensing and asset cost |

## Current provider

**Mask people only** uses the DeepLabV3 FP16 model from Apple’s Core ML catalog. The host selects the person class, caches its mask locally, and retries failed inference with Vision person segmentation. The separate **Blur images containing people** mode uses Vision body and face rectangles and blurs the entire image. The seven-level and skin modes use separate bundled models.

The `Silhouette-benchmark` Actions artifact contains the COCO128-seg measurements for the packaged helper and before/after screenshots from Chromium. Image-level errors, pixel overlap, and hardware-dependent timings describe different aspects of performance.

## Suggested bake-off

1. Keep Vision as the baseline for whole-person masks.
2. Evaluate OpenNSFW2 for a coarse explicit-content signal; export a candidate to Core ML only if output parity and performance remain acceptable.
3. Evaluate the MediaPipe model that outputs skin/clothing classes for a skin-mask path.
4. Test NudeNet only in an isolated local branch if the body-part signals help. Its boxes are not a replacement for pixel masks, and do not fold AGPL code into a distributable bundle without resolving licensing.
5. Compare candidates on a local, human-reviewed corpus. Measure false negatives by category, false positives, mask leakage, cold/warm latency, model load time, peak memory, and energy. Use separate classifier and segmenter roles; do not majority-vote outputs.

No provider should be considered selected for production until it passes this evaluation on the target M4/16 GB Mac. See PRODUCT-GUIDE.md for interception, rules, rendering, and roadmap.
