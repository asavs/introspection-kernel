#!/usr/bin/env python3
"""Neutral, read-only workbench for sealed Introspection Kernel tensor traces."""

import argparse
import json
import math
import pathlib
import struct
import sys


def load_index(root):
    path = pathlib.Path(root).resolve()
    index = json.loads((path / "index.json").read_text(encoding="utf-8"))
    return path, index


def tensor(index, name, occurrence=None):
    rows = [row for row in index["tensors"] if row["tensor_name"] == name]
    if occurrence is not None:
        rows = [row for row in rows if row.get("occurrence") == occurrence]
    if not rows:
        raise SystemExit(f"tensor not found: {name}")
    if occurrence is None and len(rows) != 1:
        choices = ", ".join(str(row.get("occurrence")) for row in rows)
        raise SystemExit(f"tensor has multiple occurrences ({choices}); pass --occurrence")
    return rows[-1]


def values(root, row):
    data = (root / row["binary_file"]).read_bytes()
    kind = row["tensor_type"]
    if kind == "f32":
        width, code = 4, "f"
    elif kind == "f16":
        width, code = 2, "e"
    else:
        raise SystemExit(f"unsupported tensor type: {kind}")
    shape = row["shape"]
    strides = row["strides"]
    end = sum((shape[i] - 1) * strides[i] for i in range(4)) + width
    if len(data) < end:
        raise SystemExit(f"byte-count mismatch: need at least {end}, found {len(data)}")
    unpack = struct.Struct(f"<{code}").unpack_from
    return tuple(unpack(data, i3 * strides[3] + i2 * strides[2] + i1 * strides[1] + i0 * strides[0])[0]
                 for i3 in range(shape[3]) for i2 in range(shape[2])
                 for i1 in range(shape[1]) for i0 in range(shape[0]))


def stats(xs):
    count = len(xs)
    mean = math.fsum(xs) / count
    return {
        "count": count,
        "mean": mean,
        "mean_abs": math.fsum(abs(x) for x in xs) / count,
        "rms": math.sqrt(math.fsum(x * x for x in xs) / count),
        "min": min(xs),
        "max": max(xs),
        "positive_fraction": sum(x > 0 for x in xs) / count,
    }


def emit(value):
    print(json.dumps(value, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    describe = sub.add_parser("describe")
    describe.add_argument("name")
    describe.add_argument("--occurrence", type=int)
    stat = sub.add_parser("stats")
    stat.add_argument("name")
    stat.add_argument("--occurrence", type=int)
    sliced = sub.add_parser("slice")
    sliced.add_argument("name")
    sliced.add_argument("start", type=int)
    sliced.add_argument("count", type=int)
    sliced.add_argument("--occurrence", type=int)
    diff = sub.add_parser("diff")
    diff.add_argument("left")
    diff.add_argument("right")
    diff.add_argument("--left-occurrence", type=int)
    diff.add_argument("--right-occurrence", type=int)
    cosine = sub.add_parser("cosine")
    cosine.add_argument("left")
    cosine.add_argument("right")
    cosine.add_argument("--left-occurrence", type=int)
    cosine.add_argument("--right-occurrence", type=int)
    attention = sub.add_parser("attention-row")
    attention.add_argument("name")
    attention.add_argument("head", type=int)
    attention.add_argument("--occurrence", type=int)
    attention.add_argument("--top", type=int, default=8)
    counterfactual = sub.add_parser("attention-counterfactual")
    counterfactual.add_argument("layer", type=int)
    counterfactual.add_argument("head", type=int)
    counterfactual.add_argument("position", type=int)
    counterfactual.add_argument("--value-root")
    counterfactual.add_argument("--value-layer", type=int)
    args = parser.parse_args()
    root, index = load_index(args.root)

    if args.command == "list":
        emit({
            "schema": index.get("schema"),
            "forward_pass": index.get("forward_pass"),
            "alignment": index.get("alignment"),
            "tensors": [{key: row.get(key) for key in (
                "tensor_name", "occurrence", "tensor_type", "shape", "byte_count"
            )} for row in index["tensors"]],
        })
        return

    if args.command == "attention-counterfactual":
        attn_row = tensor(index, f"kq_soft_max-{args.layer}")
        value_root, value_index = (load_index(args.value_root) if args.value_root else (root, index))
        value_layer = args.value_layer if args.value_layer is not None else args.layer
        value_row = tensor(value_index, f"Vcache-{value_layer}")
        output_row = tensor(index, f"kqv-{args.layer}")
        attn = values(root, attn_row)
        cache = values(value_root, value_row)
        output = values(root, output_row)
        positions, queries, query_heads, streams = attn_row["shape"]
        cache_positions, kv_heads, head_width, cache_streams = value_row["shape"]
        if queries != 1 or streams != 1 or cache_streams != 1 or cache_positions < positions:
            raise SystemExit("unexpected attention/V-cache layout")
        if not 0 <= args.head < query_heads or not 0 <= args.position < positions:
            raise SystemExit("head or position outside tensor")
        kv_head = args.head * kv_heads // query_heads
        limit = min(positions, int(index["forward_pass"]["evaluated_position"]) + 1)
        weights = [attn[args.head * positions + pos] for pos in range(limit)]
        def cached(pos, dim):
            return cache[pos + cache_positions * (kv_head + kv_heads * dim)]
        reconstructed = [math.fsum(weights[pos] * cached(pos, dim) for pos in range(limit))
                         for dim in range(head_width)]
        captured = output[args.head * head_width:(args.head + 1) * head_width]
        error = [a - b for a, b in zip(reconstructed, captured)]
        weight = weights[args.position] if args.position < limit else 0.0
        contribution = [weight * cached(args.position, dim) for dim in range(head_width)]
        zero_value = [value - delta for value, delta in zip(reconstructed, contribution)]
        renormalized = [(value - delta) / (1.0 - weight) for value, delta in zip(reconstructed, contribution)] \
            if weight < 1.0 else None
        context = index.get("evaluated_context_positions") or []
        emit({
            "layer": args.layer, "query_head": args.head, "kv_head": kv_head,
            "value_source": {
                "run_id": value_index.get("run_id"),
                "forward_pass_id": value_index.get("forward_pass", {}).get("forward_pass_id"),
                "layer": value_layer,
                "matched_to_attention": value_root == root and value_layer == args.layer,
            },
            "source_position": args.position,
            "source_token": context[args.position] if args.position < len(context) else None,
            "attention_weight": weight,
            "reconstruction_error": stats(error),
            "captured_weighted_value": stats(captured),
            "source_contribution": stats(contribution),
            "counterfactual_zero_value": stats(zero_value),
            "counterfactual_remove_and_renormalize": stats(renormalized) if renormalized else None,
            "semantics": {
                "zero_value": "set this source V vector to zero while holding attention weights fixed",
                "remove_and_renormalize": "remove this source and renormalize the remaining attention weights"
            }
        })
        return

    if args.command in {"describe", "stats", "slice", "attention-row"}:
        row = tensor(index, args.name, args.occurrence)
        if args.command == "describe":
            emit(row)
            return
        xs = values(root, row)
        if args.command == "stats":
            emit({"tensor": row["tensor_name"], "occurrence": row.get("occurrence"), **stats(xs)})
            return
        if args.command == "slice":
            if args.start < 0 or args.count < 0 or args.start + args.count > len(xs):
                raise SystemExit("slice outside tensor")
            emit({"start": args.start, "count": args.count, "values": xs[args.start:args.start + args.count]})
            return
        width, queries, heads, streams = row["shape"]
        if queries != 1 or streams != 1 or not 0 <= args.head < heads:
            raise SystemExit("attention-row expects shape [positions,1,heads,1] and a valid head")
        limit = min(width, int(index["forward_pass"]["evaluated_position"]) + 1)
        base = args.head * width
        ranked = sorted(((xs[base + position], position) for position in range(limit)), reverse=True)
        prompt = index.get("evaluated_context_positions") or index.get("prompt_positions") or []
        emit({"head": args.head, "available_positions": limit,
              "top": [{"position": position, "weight": weight,
                       "token": prompt[position] if position < len(prompt) else None}
                      for weight, position in ranked[:args.top]],
              "sum_available": math.fsum(xs[base:base + limit])})
        return

    left_row = tensor(index, args.left, args.left_occurrence)
    right_row = tensor(index, args.right, args.right_occurrence)
    left = values(root, left_row)
    right = values(root, right_row)
    if len(left) != len(right):
        raise SystemExit("tensor lengths differ")
    if args.command == "diff":
        delta = [a - b for a, b in zip(left, right)]
        emit({"left": args.left, "right": args.right, **stats(delta)})
    else:
        dot = math.fsum(a * b for a, b in zip(left, right))
        nl = math.sqrt(math.fsum(a * a for a in left))
        nr = math.sqrt(math.fsum(b * b for b in right))
        emit({"left": args.left, "right": args.right, "cosine": dot / (nl * nr)})


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, KeyError, ValueError, json.JSONDecodeError) as error:
        print(f"trace error: {error}", file=sys.stderr)
        raise SystemExit(2)
