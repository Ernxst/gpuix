---
name: audit-surface
description: Probe and repair related ordinary-usage defects while fixing a GPU-IX consumer-reported bug. Automatically required by the repository instructions for consumer bug fixes.
---

# Audit the affected surface

Complete this procedure as part of the current fix. Produce tested behavior and confirmed repairs, not a list of recommendations for the user to execute.

## Establish the boundary

Start with the consumer's failing interaction, the implementation responsible for it, and its existing tests. Search related closed issues and linked fixes for earlier omissions in this same behavior. Use the repository's configured remote; narrow the search by component, API and symptom. If that history is unavailable, use local history and state the evidence gap.

Group reports sharing the implementation and behavioral contract into one audit. Reuse evidence already collected during the task. Keep the scope on ordinary usage of the affected behavior; do not recursively audit every dependency or sweep the whole repository.

## Probe missing behavior

Compare the existing assertions with the public behavior exercised by the consumer. Identify concrete missing cases suggested by the failure mechanism or related history. Consider composition, changing props/state, insertion/removal/remounting, implicit semantics and real event sequences only where they can exercise that mechanism. Reuse equivalent coverage instead of duplicating it.

Establish expected behavior from the fork's public contract and, for shared APIs, react-dom or the applicable browser reference. Inspect or run the reference where the answer is uncertain. A previous fix or reviewer prescription is not itself proof of the intended contract.

Write and run focused probes using the existing test infrastructure. Observe public results: rendered output, accessible discovery, live values, selection or event effects. Use real assets when the path depends on successful asset loading. Avoid fixtures that supply the very behavior under investigation, such as an explicit role when checking implicit semantics.

Exercise the failing execution boundary. A lease-free test renderer cannot establish live-window event safety; a declared style cannot establish painted output; a development run cannot establish compiled-app behavior. Build the affected target and restart a loaded native app when required by AGENTS.md. Missing native support or skipped relevant tests are verification gaps, not passing evidence.

## Repair and finish

For each confirmed related defect, observe the regression fail before the repair, fix it within the affected surface, and retain a meaningful regression in the existing suite. Do not require the user to file another issue for each related defect. Report unrelated findings separately; do not expand into unrelated repairs. Resolve uncertain semantics from available evidence before asking the user for a decision.

Run the affected checks together after the final changes. Reuse successful build/check evidence for unchanged artifacts; coordinate expensive native checks through the task owner rather than launching duplicate runs. Follow the repository's build and verification requirements without adding CI jobs.

Stop when the reported failure and the identified related cases have been exercised and confirmed defects repaired, or when a specific evidence/runtime blocker prevents completion. Name any blocker and the behavior left unverified; do not describe a partial audit as complete.

In the existing handoff, briefly state which related behaviors were exercised, which already worked, which defects were repaired, and the checks/results or verification gaps. Include test locations and identify the built artifact or revision used where stale consumer packages or native binaries could affect the result. Do not create a separate report or tracking system unless the task needs one.
