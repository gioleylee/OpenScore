"""Online audio sources: YouTube links and song-name search through yt-dlp.

Only YouTube hosts are accepted so the server cannot be used to fetch arbitrary
URLs (SSRF). Search returns candidates for the visitor to choose; nothing is
downloaded until a job is submitted. Downloads run in the cancellable worker.
"""

import importlib.util
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def available():
    return (
        os.environ.get("ENABLE_ONLINE_SOURCES", "1") != "0"
        and importlib.util.find_spec("yt_dlp") is not None
    )


def video_id(url: str) -> str:
    """Return the 11-character video ID of a single YouTube video, else raise."""
    url = url.strip()
    if len(url) > 500:
        raise ValueError("Link is too long")
    if VIDEO_ID.match(url):
        return url
    parsed = urlparse(url if "://" in url else "https://" + url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or host not in HOSTS:
        raise ValueError("Paste a YouTube link (youtube.com or youtu.be)")
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
    elif parsed.path in ("/watch", "/watch/"):
        candidate = (parse_qs(parsed.query).get("v") or [""])[0]
    else:
        match = re.match(r"^/(shorts|embed|live|v)/([^/?#]+)", parsed.path)
        candidate = match.group(2) if match else ""
    if not VIDEO_ID.match(candidate):
        raise ValueError(
            "That link is not a single YouTube video. Playlists and channels are not supported."
        )
    return candidate


def canonical(identifier: str) -> str:
    return f"https://www.youtube.com/watch?v={identifier}"


def _options(**extra):
    import imageio_ffmpeg

    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "noprogress": True,
        "socket_timeout": 20,
        "retries": 2,
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        # YouTube requires solving JavaScript challenges; use whichever runtime exists.
        "js_runtimes": {"deno": {}, "node": {}, "bun": {}},
        **extra,
    }


def search(query: str, limit: int = 6):
    import yt_dlp

    query = " ".join(query.split())[:150]
    if len(query) < 2:
        raise ValueError("Type a song name to search")
    with yt_dlp.YoutubeDL(_options(extract_flat="in_playlist")) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    results = []
    for entry in info.get("entries") or []:
        identifier = entry.get("id") or ""
        if not VIDEO_ID.match(identifier):
            continue
        results.append(
            {
                "id": identifier,
                "url": canonical(identifier),
                "title": str(entry.get("title") or "Untitled")[:200],
                "channel": str(entry.get("channel") or entry.get("uploader") or "")[
                    :120
                ],
                "duration": entry.get("duration"),
                "thumbnail": f"https://i.ytimg.com/vi/{identifier}/mqdefault.jpg",
            }
        )
    return results


def download(url: str, directory: Path, max_duration: float, max_bytes: int):
    """Download the audio stream of one video to directory/upload; return title."""
    import yt_dlp

    try:
        return _download(yt_dlp, url, directory, max_duration, max_bytes)
    except yt_dlp.utils.DownloadError as exc:
        text = str(exc).lower()
        if "sign in" in text or "age" in text:
            reason = "it requires sign-in or age verification"
        elif "private" in text or "unavailable" in text or "removed" in text:
            reason = "it is private, removed, or unavailable"
        elif "country" in text or "region" in text:
            reason = "it is not available in the server's region"
        else:
            reason = "YouTube refused the request"
        raise ValueError(
            f"The video's audio could not be downloaded because {reason}. Try another result or upload a file."
        ) from exc


def _download(yt_dlp, url, directory, max_duration, max_bytes):
    identifier = video_id(url)
    with yt_dlp.YoutubeDL(_options()) as ydl:
        info = ydl.extract_info(canonical(identifier), download=False)
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise ValueError("Live streams cannot be transcribed")
    duration = info.get("duration") or 0
    if duration > max_duration:
        raise ValueError(
            f"This video is {duration / 60:.1f} minutes; the server limit is {max_duration / 60:g} minutes. Choose a shorter version."
        )
    target = directory / "download"
    options = _options(
        format="bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best[height<=360]",
        outtmpl=str(target) + ".%(ext)s",
        max_filesize=max_bytes,
    )
    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([canonical(identifier)])
    files = sorted(directory.glob("download.*"))
    files = [f for f in files if not f.name.endswith((".part", ".ytdl"))]
    if not files:
        raise ValueError(
            "The audio could not be downloaded (it may exceed the size limit, be private, or be region-locked)."
        )
    files[0].replace(directory / "upload")
    title = str(info.get("title") or "YouTube audio")
    return "".join(c for c in title if c.isprintable())[:100] or "YouTube audio"
