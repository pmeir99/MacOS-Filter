# On-device model options

## Recommended structure

Keep inference in the macOS Swift process. The extension owns page discovery and overlays and talks to the host through Chrome Native Messaging. Expose rules in the UI only when the installed provider advertises that capability.

Treat each image decision as two separate outputs:

1. Classification: image or person-level labels, confidence scores, and optional visual-presentation labels.
2. Segmentation: person, skin, clothing, or body-region masks used to paint over pixels.

A classifier can decide that an image is in a category without locating the pixels to cover. A segmenter can find a person without deciding how modest or explicit the image is. Some modes need both.

## Available paths

| Option | Useful output | Device/runtime fit | Limits |
| --- | --- | --- | --- |
| Apple Vision person segmentation | Person matte | Built into macOS; no model download; native Vision runtime | Person silhouette only; no exposed-skin, clothing, gender, or modesty labels |
| NudeNet 320n or 640m ONNX | 18 body-part and face labels, including exposed/covered anatomy and FACE_MALE/FACE_FEMALE detections | Runs locally through an ONNX/Core ML adapter; model files are separate | Box detections, not pixel-accurate skin masks; no seven-level modesty score; AGPL-3.0 license must be evaluated before distribution |
| U²-Net clothing segmentation converted to Core ML | Upper, lower, and full-body clothing regions | An available Core ML package is about 84 MB; on-device model compile/download | Does not directly label exposed skin or classify modesty; source/model provenance and license need review |
| Apple Core AI ImageSegmenter with SAM 3 | Prompt-based masks for concepts or objects | Apple Silicon; macOS 27; optional model download. Apple reports a 623 MB sample asset | Large, gated model assets; segmentation is not a calibrated seven-level content classifier |

The Vision option is the best dependable baseline for image-wide and all-person modes. It is already implemented. SAM 3 is a promising optional segmentation path for prompt-driven regions, but it does not replace an exposure classifier. NudeNet has some matching labels, but its boxes and license mean we should test it as a separately installed provider before deciding whether it belongs in this app. The clothing parser may contribute to a skin-mask pipeline, but its documented output is clothing labels, not a validated skin mask.

## Mapping requested rules

- Entire image: deterministic overlay; no model required.
- All people: Vision person mask.
- One selected person or male/female visual presentation: needs person instances and a reliable face/person association. NudeNet's face labels are visual model classes, not a person's actual gender; occluded or missing faces need a defined fallback.
- Skin only or selected body parts: needs a pixel-level human parser or body-part segmentation model. A rectangular detector box is not an adequate skin mask.
- Seven modesty levels: no single available model found that directly provides calibrated, consistent scores for the examples. A workable route is a local image/person classifier plus body-part/exposure detections and configurable thresholds. The definitions need to be observable labels such as explicit activity, exposed intimate anatomy, underwear/swimwear, visible skin amount, and clothing coverage. “Beach,” “tight,” and “modest” are contextual or subjective; treat them as configurable review categories rather than objective model truths.

No mode should be advertised as reliable until it is evaluated on varied images with false-negative/false-positive rates and mask alignment. The initial version therefore offers only full-image and all-person cover.
