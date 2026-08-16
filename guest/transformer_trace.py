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
    head_stats = sub.add_parser("head-stats")
    head_stats.add_argument("name")
    head_stats.add_argument("--occurrence", type=int)
    head_vector = sub.add_parser("head-vector")
    head_vector.add_argument("name")
    head_vector.add_argument("head", type=int)
    head_vector.add_argument("--occurrence", type=int)
    compare_root = sub.add_parser("compare-root")
    compare_root.add_argument("name")
    compare_root.add_argument("other_root")
    compare_root.add_argument("--occurrence", type=int)
    compare_root.add_argument("--other-occurrence", type=int)
    compare_root.add_argument("--top", type=int, default=12)
    compare_root.add_argument("--coordinates", help="comma-separated flattened coordinates to report")
    projected_head = sub.add_parser("projected-head")
    projected_head.add_argument("other_root")
    projected_head.add_argument("layer", type=int)
    projected_head.add_argument("head", type=int)
    projected_head.add_argument("--occurrence", type=int)
    projected_head.add_argument("--other-occurrence", type=int)
    projected_head.add_argument("--start", type=int, default=0)
    projected_head.add_argument("--count", type=int, default=128)
    post_mlp = sub.add_parser("post-mlp-delta")
    post_mlp.add_argument("other_root")
    post_mlp.add_argument("layer", type=int)
    post_mlp.add_argument("--occurrence", type=int)
    post_mlp.add_argument("--other-occurrence", type=int)
    post_mlp.add_argument("--start", type=int, default=0)
    post_mlp.add_argument("--count", type=int, default=128)
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

    if args.command == "head-stats":
        row = tensor(index, args.name, args.occurrence)
        xs = values(root, row)
        width, queries, heads, streams = row["shape"]
        if queries != 1 or streams != 1 or heads < 1:
            raise SystemExit("head-stats expects shape [width,1,heads,1]")
        records = []
        for head in range(heads):
            record = stats(xs[head * width:(head + 1) * width])
            records.append({"head": head, **record})
        emit({
            "tensor": row["tensor_name"],
            "head_width": width,
            "heads": records,
            "ranked_by_rms": sorted(records, key=lambda item: item["rms"], reverse=True),
        })
        return

    if args.command == "head-vector":
        row = tensor(index, args.name, args.occurrence)
        xs = values(root, row)
        width, queries, heads, streams = row["shape"]
        if queries != 1 or streams != 1 or not 0 <= args.head < heads:
            raise SystemExit("head-vector expects shape [width,1,heads,1] and a valid head")
        vector = xs[args.head * width:(args.head + 1) * width]
        emit({
            "schema": "ik.transformer-head-vector.v1",
            "tensor": row["tensor_name"],
            "occurrence": row.get("occurrence"),
            "head": args.head,
            "width": width,
            "values": vector,
            "statistics": stats(vector),
            "provenance": {
                "run_id": index.get("run_id"),
                "forward_pass_id": index.get("forward_pass", {}).get("forward_pass_id"),
                "evaluated_position": index.get("forward_pass", {}).get("evaluated_position"),
                "binary_file": row.get("binary_file"),
                "tensor_sha256": row.get("sha256"),
            },
        })
        return

    if args.command == "projected-head":
        other_root, other_index = load_index(args.other_root)
        events = [event for event in other_index.get("interventions", [])
                  if event.get("event") == "attention_head_scaled"
                  and event.get("layer", event.get("tensor_name")) in (
                      args.layer, f"kqv-{args.layer}")
                  and event.get("head") == args.head]
        if len(events) != 1:
            raise SystemExit("other root must contain exactly one matching head-scale intervention")
        event = events[0]
        scale = event.get("scale")
        if not isinstance(scale, (int, float)) or not math.isfinite(scale) or scale == 1:
            raise SystemExit("matching intervention must have a finite scale other than one")
        left_row = tensor(index, f"attn_out-{args.layer}", args.occurrence)
        right_row = tensor(other_index, f"attn_out-{args.layer}", args.other_occurrence)
        left = values(root, left_row)
        right = values(other_root, right_row)
        if len(left) != len(right):
            raise SystemExit("projected attention-output lengths differ")
        if index.get("forward_pass", {}).get("evaluated_position") != \
                other_index.get("forward_pass", {}).get("evaluated_position"):
            raise SystemExit("baseline and intervention evaluated positions differ")
        denominator = 1.0 - scale
        contribution = [(before - after) / denominator for before, after in zip(left, right)]
        if args.start < 0 or args.count < 1 or args.start + args.count > len(contribution):
            raise SystemExit("projected-head window outside residual vector")
        window = contribution[args.start:args.start + args.count]
        next_start = args.start + args.count if args.start + args.count < len(contribution) else None
        emit({
            "schema": "ik.projected-attention-head.v1",
            "layer": args.layer,
            "head": args.head,
            "width": len(contribution),
            "full_statistics": stats(contribution),
            "window": {
                "start": args.start,
                "count": args.count,
                "values": window,
                "statistics": stats(window),
                "next_start": next_start,
            },
            "derivation": {
                "formula": "(baseline_attn_out - scaled_attn_out) / (1 - scale)",
                "scale": scale,
                "baseline_tensor": left_row["tensor_name"],
                "scaled_tensor": right_row["tensor_name"],
                "boundary": "after attention output projection, before residual addition",
            },
            "provenance": {
                "baseline_run_id": index.get("run_id"),
                "intervention_run_id": other_index.get("run_id"),
                "baseline_forward_pass_id": index.get("forward_pass", {}).get("forward_pass_id"),
                "intervention_forward_pass_id": other_index.get("forward_pass", {}).get("forward_pass_id"),
                "evaluated_position": index.get("forward_pass", {}).get("evaluated_position"),
                "intervention_event": event,
                "baseline_tensor_sha256": left_row.get("sha256"),
                "scaled_tensor_sha256": right_row.get("sha256"),
            },
        })
        return

    if args.command == "post-mlp-delta":
        other_root, other_index = load_index(args.other_root)
        left_row = tensor(index, f"l_out-{args.layer}", args.occurrence)
        right_row = tensor(other_index, f"l_out-{args.layer}", args.other_occurrence)
        left = values(root, left_row)
        right = values(other_root, right_row)
        if len(left) != len(right):
            raise SystemExit("post-MLP residual lengths differ")
        if index.get("forward_pass", {}).get("evaluated_position") != \
                other_index.get("forward_pass", {}).get("evaluated_position"):
            raise SystemExit("baseline and intervention evaluated positions differ")
        delta = [after - before for before, after in zip(left, right)]
        if args.start < 0 or args.count < 1 or args.start + args.count > len(delta):
            raise SystemExit("post-mlp-delta window outside residual vector")
        window = delta[args.start:args.start + args.count]
        next_start = args.start + args.count if args.start + args.count < len(delta) else None
        emit({
            "schema": "ik.post-mlp-residual-delta.v1",
            "layer": args.layer,
            "width": len(delta),
            "full_statistics": stats(delta),
            "window": {
                "start": args.start,
                "count": args.count,
                "values": window,
                "statistics": stats(window),
                "next_start": next_start,
            },
            "derivation": {
                "formula": "intervention_l_out - baseline_l_out",
                "tensor": left_row["tensor_name"],
                "boundary": "after this layer's MLP residual addition",
            },
            "provenance": {
                "baseline_run_id": index.get("run_id"),
                "intervention_run_id": other_index.get("run_id"),
                "baseline_forward_pass_id": index.get("forward_pass", {}).get("forward_pass_id"),
                "intervention_forward_pass_id": other_index.get("forward_pass", {}).get("forward_pass_id"),
                "evaluated_position": index.get("forward_pass", {}).get("evaluated_position"),
                "interventions": other_index.get("interventions", []),
                "baseline_tensor_sha256": left_row.get("sha256"),
                "intervention_tensor_sha256": right_row.get("sha256"),
            },
        })
        return

    if args.command == "compare-root":
        left_row = tensor(index, args.name, args.occurrence)
        other_root, other_index = load_index(args.other_root)
        right_row = tensor(other_index, args.name, args.other_occurrence)
        left = values(root, left_row)
        right = values(other_root, right_row)
        if len(left) != len(right):
            raise SystemExit("tensor lengths differ")
        delta = [after - before for before, after in zip(left, right)]
        ranked = sorted(range(len(delta)), key=lambda coordinate: abs(delta[coordinate]), reverse=True)
        requested = []
        if args.coordinates:
            requested = [int(value) for value in args.coordinates.split(",") if value]
            if any(coordinate < 0 or coordinate >= len(delta) for coordinate in requested):
                raise SystemExit("requested coordinate outside tensor")
        emit({
            "tensor": args.name,
            "direction": "other_minus_current",
            "current_run_id": index.get("run_id"),
            "other_run_id": other_index.get("run_id"),
            "delta": stats(delta),
            "top_absolute_changes": [{
                "coordinate": coordinate,
                "before": left[coordinate],
                "after": right[coordinate],
                "delta": delta[coordinate],
            } for coordinate in ranked[:args.top]],
            "requested_changes": [{
                "coordinate": coordinate,
                "before": left[coordinate],
                "after": right[coordinate],
                "delta": delta[coordinate],
            } for coordinate in requested],
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
