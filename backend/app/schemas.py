from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_NOTES = 12000


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    mode: Literal["melody", "piano", "guitar", "bass", "ukulele"] = "melody"
    engine: Literal["pyin", "basic_pitch"] = "pyin"
    instrument: str = Field(default="Guitar", max_length=60)
    start: float = Field(default=0, ge=0, le=3600)
    end: float | None = Field(default=None, gt=0, le=3600)
    tempo: float | None = Field(default=None, ge=30, le=300)
    numerator: int = Field(default=4, ge=2, le=12)
    denominator: Literal[4, 8] = 4
    grid: Literal[0.25, 0.5, 1.0] = 0.25
    min_duration: float = Field(default=0.09, ge=0.04, le=1)
    sensitivity: float = Field(default=0.3, ge=0.1, le=0.9)
    tuning: list[int] = Field(
        default_factory=lambda: [40, 45, 50, 55, 59, 64], min_length=4, max_length=6
    )
    capo: int = Field(default=0, ge=0, le=12)
    min_fret: int = Field(default=0, ge=0, le=24)
    max_fret: int = Field(default=20, ge=1, le=24)
    separate: Literal["none", "vocals", "bass", "guitar", "piano", "other"] = Field(
        default="none",
        description="Isolate this stem from a full mix with Demucs before detection",
    )

    @model_validator(mode="after")
    def valid(self):
        if self.end is not None and self.end <= self.start:
            raise ValueError("Segment end must follow start")
        if self.min_fret > self.max_fret:
            raise ValueError("Minimum fret exceeds maximum")
        if any(p < 20 or p > 90 for p in self.tuning):
            raise ValueError("Tuning pitches must be MIDI 20–90, low to high")
        # Ukulele uses re-entrant tuning (high G), so only its order is free.
        if self.mode != "ukulele" and self.tuning != sorted(self.tuning):
            raise ValueError("Tuning must be ordered low to high")
        if self.mode == "bass" and len(self.tuning) != 4:
            raise ValueError("Bass requires four strings")
        if self.mode == "ukulele" and len(self.tuning) != 4:
            raise ValueError("Ukulele requires four strings")
        if self.mode == "guitar" and len(self.tuning) != 6:
            raise ValueError("Guitar requires six strings")
        if self.mode == "piano" and self.engine != "basic_pitch":
            raise ValueError("Piano polyphony requires Basic Pitch")
        return self


class Note(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(max_length=80)
    pitch: int = Field(ge=0, le=127)
    onset: float = Field(
        ge=0, le=1024, description="Quarter-note beats from segment start"
    )
    duration: float = Field(ge=0.0625, le=128)
    velocity: int = Field(default=85, ge=1, le=127)
    string: int | None = Field(default=None, ge=1, le=6)
    fret: int | None = Field(default=None, ge=0, le=24)


class Score(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    title: str = Field(default="Untitled", max_length=120)
    tempo: float = Field(ge=30, le=300)
    key: int = Field(
        default=0, ge=-7, le=7, description="Key signature sharps; manually chosen"
    )
    settings: Settings
    notes: list[Note] = Field(max_length=MAX_NOTES)
    warnings: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid(self):
        if len({n.id for n in self.notes}) != len(self.notes):
            raise ValueError("Note IDs must be unique")
        for n in self.notes:
            if (n.string is None) != (n.fret is None):
                raise ValueError("String and fret must be set together")
            if n.string is not None:
                s = self.settings
                if (
                    n.string > len(s.tuning)
                    or n.pitch != s.tuning[-n.string] + s.capo + n.fret
                ):
                    raise ValueError("String/fret does not match sounding pitch")
                if not s.min_fret <= n.fret <= s.max_fret:
                    raise ValueError("Fret is outside selected region")
        return self
