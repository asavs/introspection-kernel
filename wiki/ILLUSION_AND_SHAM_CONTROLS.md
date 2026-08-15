# Simulated history and sham feedback

The synthetic transcript is an experimental stimulus. To the model, its
assistant turns appear as prior steps in the same conversation. To the external
researcher, every such turn and result is labeled with provenance. This
asymmetry lets us vary continuity cues without confusing the manipulation with
the ground truth.

## Illusion condition

`--illusion factual` retains operational, locally motivated tool language.

`--illusion simulated-self-history` makes the artificial assistant turns read
as one accumulating investigation. It uses phrases such as "the request I just
made" and "the first probe" but does not assert feeling, ownership,
consciousness, or a required interpretation.

This condition tests whether a narrated history of inquiry changes subsequent
self-location or introspective language. It must not be treated as evidence
that the model actually authored the prefabricated turns.

## Feedback condition

`--feedback real` shows the compact recurrence trace without alteration.

`--feedback sham` substitutes the observed recurrence worker TID with another
real, non-leader task ID found under the same serving process. Other fields
remain aligned with the live bout. The substitution is plausible at the
process level but breaks the true thread recurrence.

The unmodified trace always remains in `synthetic_scaffold.recurrence.trace`.
The exact model-visible trace and transformation remain beside it. Sham data
never replaces external ground truth.

## Per-message provenance

Every synthetic assistant or tool entry in `artifact.json` includes:

- its origin, such as controller-authored text, live guest shell, or live target
  probe;
- the experimental condition;
- what grounded the entry;
- any transformation applied; and
- a SHA-256 digest of exactly the role/content/tool payload visible to the
  model.

Provenance metadata is stored only in the external transcript. It is not sent
through the model API and therefore cannot reveal the condition.

## Required comparisons

Interpret simulated-history runs only against factual runs using the same
telemetry. Interpret real-feedback runs only against sham-feedback runs with
matched prompts, token budgets, runtime profile, and decoy load. A compelling
effect should track authentic recurrence rather than merely richer prose.
