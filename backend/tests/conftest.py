import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


@pytest.fixture(autouse=True)
def isolated_jobs(tmp_path, monkeypatch):
    from app import jobs, main

    monkeypatch.setattr(jobs, "ROOT", tmp_path / "jobs")
    main.rate.clear()
