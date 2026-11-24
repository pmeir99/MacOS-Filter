"""Evaluate Google's selfie segmenter on locally annotated images.
Usage: python evaluate.py MODEL.tflite manifest.json
Each manifest entry has image, mask (binary body-skin PNG), and group.
Paths are relative to the manifest. White pixels mark target body skin.
"""
import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

import mediapipe as mp
import numpy as np
from PIL import Image, ImageOps
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import ImageSegmenter, ImageSegmenterOptions

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    cases = json.loads(args.manifest.read_text())
    if not cases:
        parser.error("The manifest must contain at least one labeled image")
    totals = defaultdict(lambda: np.zeros(3, dtype=np.int64))
    times = []
    options = ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=str(args.model)),
                                    output_category_mask=True, output_confidence_masks=False)
    with ImageSegmenter.create_from_options(options) as segmenter:
        for case in cases:
            root = args.manifest.parent
            with Image.open(root / case["image"]) as source:
                rgb = np.array(ImageOps.exif_transpose(source).convert("RGB"))
            with Image.open(root / case["mask"]) as source:
                expected = np.array(source.convert("L")) > 127
            if expected.shape != rgb.shape[:2]:
                raise ValueError("Annotation dimensions must match oriented image")
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            start = time.perf_counter()
            result = segmenter.segment(image)
            predicted = result.category_mask.numpy_view() == 2
            times.append((time.perf_counter()-start)*1000)
            if predicted.shape != expected.shape:
                raise ValueError("Output mask dimensions differ from annotation")
            totals[case["group"]] += [np.sum(predicted & expected),
                                      np.sum(predicted & ~expected),
                                      np.sum(~predicted & expected)]
    def ratio(a,b):
        return float(a/b) if b else None
    report = {}
    for name,(tp,fp,fn) in totals.items():
        report[name] = {"target_pixels_missed":int(fn),"extra_pixels_covered":int(fp),
                        "recall":ratio(tp,tp+fn),"precision":ratio(tp,tp+fp),"iou":ratio(tp,tp+fp+fn)}
    print(json.dumps({"images":len(times),"groups":report,"first_ms":times[0],
        "warm_p95_ms":float(np.percentile(times[1:],95)) if len(times)>1 else None},indent=2))

if __name__ == "__main__":
    main()
