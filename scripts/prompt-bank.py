from pathlib import Path
import json, sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

work, output = map(Path,sys.argv[1:])
tokenizer = Tokenizer.from_file(str(work/"tokenizer.json"))
session = ort.InferenceSession(str(work/"text.onnx"),providers=["CPUExecutionProvider"])
labels = json.loads(Path("models/policy_labels.json").read_text())
vectors = []
for group in labels.values():
    for descriptions in group:
        rows = []
        for phrase in descriptions:
            ids = np.array([tokenizer.encode("a photo of "+phrase).ids],dtype=np.int64)
            inputs = {"input_ids":ids,"attention_mask":np.ones_like(ids)}
            vec = session.run(["text_embeds"],{i.name:inputs[i.name] for i in session.get_inputs()})[0].reshape(-1)
            rows.append(vec / np.linalg.norm(vec))
        avg = np.mean(rows,axis=0)
        vectors.append(avg/np.linalg.norm(avg))
np.save(output/"prompts.npy",np.stack(vectors))
np.stack(vectors).astype("<f4").tofile(output/"prompts.f32")
