#!/usr/bin/env python3
"""Read GGUF structure without loading or interpreting the model tensors."""

import argparse
import hashlib
import json
import os
import struct
from functools import reduce
from operator import mul


VALUE_TYPES = {
    0: ("uint8", "<B"), 1: ("int8", "<b"),
    2: ("uint16", "<H"), 3: ("int16", "<h"),
    4: ("uint32", "<I"), 5: ("int32", "<i"),
    6: ("float32", "<f"), 7: ("bool", "<?"),
    10: ("uint64", "<Q"), 11: ("int64", "<q"),
    12: ("float64", "<d"),
}

GGML_TYPES = {
    0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1",
    8: "Q8_0", 9: "Q8_1", 10: "Q2_K", 11: "Q3_K", 12: "Q4_K",
    13: "Q5_K", 14: "Q6_K", 15: "Q8_K", 16: "IQ2_XXS", 17: "IQ2_XS",
    18: "IQ3_XXS", 19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S", 22: "IQ2_S",
    23: "IQ4_XS", 24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64",
    29: "IQ1_M", 30: "BF16", 31: "TQ1_0", 32: "TQ2_0", 33: "MXFP4",
}


class Reader:
    def __init__(self, handle):
        self.handle = handle

    def read(self, size):
        data = self.handle.read(size)
        if len(data) != size:
            raise EOFError(f"wanted {size} bytes at offset {self.handle.tell() - len(data)}")
        return data

    def unpack(self, fmt):
        return struct.unpack(fmt, self.read(struct.calcsize(fmt)))[0]

    def u32(self):
        return self.unpack("<I")

    def u64(self):
        return self.unpack("<Q")

    def string(self):
        length = self.u64()
        return self.read(length).decode("utf-8", errors="replace")


def compact_string(value):
    encoded = value.encode("utf-8")
    if len(encoded) <= 4096:
        return value
    return {
        "kind": "string_summary",
        "utf8_bytes": len(encoded),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "prefix": value[:1024],
        "suffix": value[-256:],
    }


def read_value(reader, value_type, summarize_arrays=True):
    if value_type in VALUE_TYPES:
        return reader.unpack(VALUE_TYPES[value_type][1])
    if value_type == 8:
        return compact_string(reader.string())
    if value_type != 9:
        raise ValueError(f"unsupported GGUF metadata value type {value_type}")

    element_type = reader.u32()
    count = reader.u64()
    preview = []
    tail = []
    digest = hashlib.sha256()
    for index in range(count):
        value = read_value(reader, element_type, summarize_arrays=False)
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        digest.update(struct.pack("<Q", len(encoded)))
        digest.update(encoded)
        if index < 8:
            preview.append(value)
        tail.append(value)
        if len(tail) > 2:
            tail.pop(0)
    if not summarize_arrays and count <= 32:
        return preview + ([] if count <= 8 else tail)
    return {
        "kind": "array_summary",
        "element_type_id": element_type,
        "element_type": VALUE_TYPES.get(element_type, ("string" if element_type == 8 else "array",))[0],
        "count": count,
        "length_prefixed_json_sha256": digest.hexdigest(),
        "first": preview,
        "last": [] if count <= 8 else tail,
    }


def inventory(path):
    file_size = os.path.getsize(path)
    with open(path, "rb") as handle:
        reader = Reader(handle)
        magic = reader.read(4)
        if magic != b"GGUF":
            raise ValueError(f"not a GGUF file: magic={magic!r}")
        version = reader.u32()
        tensor_count = reader.u64()
        metadata_count = reader.u64()
        metadata = {}
        metadata_types = {}
        for _ in range(metadata_count):
            key = reader.string()
            value_type = reader.u32()
            metadata[key] = read_value(reader, value_type)
            metadata_types[key] = value_type

        tensors = []
        for index in range(tensor_count):
            name = reader.string()
            n_dims = reader.u32()
            dimensions = [reader.u64() for _ in range(n_dims)]
            ggml_type = reader.u32()
            relative_offset = reader.u64()
            tensors.append({
                "index": index,
                "name": name,
                "dimensions": dimensions,
                "elements": reduce(mul, dimensions, 1),
                "ggml_type_id": ggml_type,
                "ggml_type": GGML_TYPES.get(ggml_type, f"UNKNOWN_{ggml_type}"),
                "relative_offset": relative_offset,
            })

        header_end = handle.tell()
        alignment_value = metadata.get("general.alignment", 32)
        alignment = alignment_value if isinstance(alignment_value, int) else 32
        data_offset = ((header_end + alignment - 1) // alignment) * alignment
        ordered = sorted(tensors, key=lambda row: row["relative_offset"])
        for position, tensor in enumerate(ordered):
            absolute_offset = data_offset + tensor["relative_offset"]
            next_offset = (
                data_offset + ordered[position + 1]["relative_offset"]
                if position + 1 < len(ordered) else file_size
            )
            tensor["absolute_offset"] = absolute_offset
            tensor["span_to_next_tensor_or_eof"] = max(0, next_offset - absolute_offset)

    return {
        "schema": "ik.gguf-inventory.v1",
        "source_path": path,
        "file_size": file_size,
        "magic": magic.decode("ascii"),
        "version": version,
        "tensor_count": tensor_count,
        "metadata_count": metadata_count,
        "header_end": header_end,
        "alignment": alignment,
        "data_offset": data_offset,
        "metadata_value_type_ids": metadata_types,
        "metadata": metadata,
        "tensors": tensors,
        "raw_access": {
            "format": "GGUF",
            "file": path,
            "note": "absolute_offset indexes the original read-only file; span includes any padding before the next tensor",
        },
        "provenance": "parsed_directly_from_guest_visible_model_file",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model")
    args = parser.parse_args()
    print(json.dumps(inventory(args.model), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
