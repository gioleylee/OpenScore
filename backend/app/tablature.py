from itertools import product

from .schemas import Note, Settings


def candidates(pitch, settings):
    return [
        (len(settings.tuning) - i, pitch - tuning - settings.capo)
        for i, tuning in enumerate(settings.tuning)
        if settings.min_fret <= pitch - tuning - settings.capo <= settings.max_fret
    ]


def optimize(notes: list[Note], settings: Settings, beam_width=48):
    """Beam search over onset groups; sustain occupancy is carried across groups.

    Hard constraints: distinct strings, <=4 stopped frets/fingers, <=4 fret span.
    A barre counts as one finger. This is a conservative heuristic, not a hand model.
    Unplayable groups remain audible and explicitly unmapped, never silently dropped.
    """
    groups = {}
    for n in sorted(notes, key=lambda n: (n.onset, n.pitch)):
        n.string = n.fret = None
        groups.setdefault(n.onset, []).append(n)
    # cost, position, occupied {string: (end, fret)}, path
    beam = [(0.0, 0.0, {}, [])]
    unmapped = 0
    for onset, group in groups.items():
        options = [candidates(n.pitch, settings) for n in group]
        assignments = []
        # Bound chord combinatorics. Six strings is the maximum supported instrument.
        if len(group) <= len(settings.tuning) and all(options):
            for combo in product(*options):
                if len({s for s, _ in combo}) != len(combo):
                    continue
                frets = [f for _, f in combo if f]
                if frets and max(frets) - min(frets) > 4:
                    continue
                if len(set(frets)) > 4:
                    continue
                assignments.append(combo)
        next_beam = []
        for cost, position, occupied, path in beam:
            live = {
                s: state for s, state in occupied.items() if state[0] > onset + 1e-6
            }
            for combo in assignments:
                if any(s in live for s, _ in combo):
                    continue
                frets = [f for _, f in combo if f] + [f for _, f in live.values() if f]
                if frets and (max(frets) - min(frets) > 4 or len(set(frets)) > 4):
                    continue
                new_position = sum(frets) / len(frets) if frets else position
                stretch = (max(frets) - min(frets)) if frets else 0
                local = (
                    abs(new_position - position) * 1.5
                    + stretch**2 * 0.5
                    + sum(f for _, f in combo) * 0.03
                )
                if settings.mode == "violin":
                    # Stay in first position (open to 4th finger) unless the
                    # note requires shifting, as violin teachers write it.
                    local += sum(max(0, f - 7) for _, f in combo) * 2.0
                new_live = {
                    **live,
                    **{s: (onset + n.duration, f) for n, (s, f) in zip(group, combo)},
                }
                next_beam.append((cost + local, new_position, new_live, path + [combo]))
            # Keep an honest unassigned option rather than inventing or dropping pitches.
            next_beam.append((cost + 1000, position, live, path + [None]))
        beam = sorted(next_beam, key=lambda x: x[0])[:beam_width]
    for group, combo in zip(groups.values(), beam[0][3]):
        if combo is None:
            unmapped += len(group)
        else:
            for n, (string, fret) in zip(group, combo):
                n.string, n.fret = string, fret
    warnings = []
    if unmapped:
        warnings.append(
            f"{unmapped} notes have no playable fingering under the selected constraints. They remain in staff/MIDI; tab shows '?' placeholders. Change tuning, region or notes."
        )
    warnings.append(
        "Tab fingerings use a conservative four-fret-span heuristic. Review chords and sustained notes for your technique."
    )
    return warnings


def ascii_tab(score):
    s = score.settings
    groups = {}
    for n in sorted(score.notes, key=lambda x: (x.onset, x.pitch)):
        groups.setdefault(n.onset, []).append(n)
    lines = [
        f"{score.title}\n{score.tempo:g} BPM; onsets in quarter-note beats; frets relative to capo {s.capo}\n"
    ]
    items = list(groups.items())
    for start in range(0, len(items), 12):
        block = items[start : start + 12]
        lines.append("beat " + "".join(f"{beat:<7g}" for beat, _ in block))
        for string in range(1, len(s.tuning) + 1):
            cells = []
            for _, group in block:
                note = next((n for n in group if n.string == string), None)
                cells.append((str(note.fret) if note else "-").center(7, "-"))
            lines.append(f"{string:>3} |" + "".join(cells) + "|")
        missing = [
            (beat, n.pitch) for beat, group in block for n in group if n.string is None
        ]
        if missing:
            lines.append("? unmapped (beat, MIDI pitch): " + str(missing))
        lines.append("")
    return "\n".join(lines)
