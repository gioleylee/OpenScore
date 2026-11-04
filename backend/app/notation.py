import io
import xml.etree.ElementTree as ET

import mido
from music21 import clef, instrument, key, meter, note, stream, tempo

from .schemas import Score


def midi_bytes(score: Score):
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(score.tempo)))
    track.append(mido.MetaMessage("time_signature", numerator=score.settings.numerator,
                                  denominator=score.settings.denominator))
    program = {"piano": 0, "guitar": 24, "bass": 33}.get(score.settings.mode, 0)
    track.append(mido.Message("program_change", program=program))
    events = []
    for n in score.notes:
        events.extend([(round(n.onset * 480), 1, n), (round((n.onset + n.duration) * 480), 0, n)])
    previous = 0
    for tick, on, n in sorted(events, key=lambda x: (x[0], x[1], x[2].pitch)):
        track.append(mido.Message("note_on" if on else "note_off", note=n.pitch,
                                  velocity=n.velocity if on else 0, time=tick - previous))
        previous = tick
    out = io.BytesIO()
    midi.save(file=out)
    return out.getvalue()


def musicxml(score: Score, view="staff"):
    """Each overlapping event occupies a voice, preserving independent durations.

    music21 makes rests, measures, ties and rhythm spelling. Piano is split at C4
    as a readability heuristic, without claiming original hand assignments.
    """
    root = stream.Score()
    from music21 import metadata
    root.metadata = metadata.Metadata(title=score.title)
    tab = view == "tab" and score.settings.mode in ("guitar", "bass")
    partitions = [score.notes]
    if score.settings.mode == "piano":
        partitions = [[n for n in score.notes if n.pitch >= 60], [n for n in score.notes if n.pitch < 60]]
    for index, notes in enumerate(partitions):
        part = stream.Part(id=f"P{index + 1}")
        part.partName = score.settings.instrument + (" · upper" if index == 0 and len(partitions) == 2 else " · lower" if len(partitions) == 2 else "")
        part.insert(0, instrument.Instrument())
        part.insert(0, meter.TimeSignature(f"{score.settings.numerator}/{score.settings.denominator}"))
        part.insert(0, key.KeySignature(score.key))
        part.insert(0, tempo.MetronomeMark(number=score.tempo))
        part.insert(0, clef.BassClef() if index == 1 or score.settings.mode == "bass" else clef.TrebleClef())
        voices, ends = [], []
        for n in sorted(notes, key=lambda x: (x.onset, x.pitch)):
            vi = next((i for i, end in enumerate(ends) if end <= n.onset + 1e-6), len(ends))
            if vi == len(ends):
                voices.append(stream.Voice(id=str(vi + 1)))
                ends.append(0)
            value = note.Note(n.pitch, quarterLength=n.duration)
            value.volume.velocity = n.velocity
            if tab and n.string is not None:
                from music21 import articulations
                value.articulations.extend([articulations.StringIndication(n.string), articulations.FretIndication(n.fret)])
            elif tab:
                value.addLyric("?")
            voices[vi].insert(n.onset, value)
            ends[vi] = n.onset + n.duration
        if not voices:
            part.append(note.Rest(quarterLength=4))
        for voice in voices:
            voice.makeRests(fillGaps=True, inPlace=True)
            part.insert(0, voice)
        root.insert(0, part)
    root.makeNotation(inPlace=True)
    from music21.musicxml.m21ToXml import GeneralObjectExporter
    data = GeneralObjectExporter(root).parse()
    if not tab:
        return data
    xml = ET.fromstring(data)
    for part in xml.findall("part"):
        for measure in part.findall("measure"):
            for c in measure.findall("attributes/clef"):
                c.find("sign").text = "TAB"
                line = c.find("line")
                if line is not None:
                    line.text = "5"
        attributes = part.find("measure/attributes")
        details = ET.SubElement(attributes, "staff-details")
        ET.SubElement(details, "staff-lines").text = str(len(score.settings.tuning))
        for i, midi in enumerate(score.settings.tuning):
            pitch = note.Note(midi + score.settings.capo).pitch
            tuning = ET.SubElement(details, "staff-tuning", line=str(i + 1))
            ET.SubElement(tuning, "tuning-step").text = pitch.step
            if pitch.accidental:
                ET.SubElement(tuning, "tuning-alter").text = str(int(pitch.accidental.alter))
            ET.SubElement(tuning, "tuning-octave").text = str(pitch.octave)
    return ET.tostring(xml, encoding="utf-8", xml_declaration=True)
