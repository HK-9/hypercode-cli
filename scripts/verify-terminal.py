"""Exercise the actual binary through a Windows pseudoterminal, not mocked IO."""

import argparse
import json
import os
from pathlib import Path
import queue
import shutil
import tempfile
import threading
import time

from winpty import PtyProcess


def scenario(binary: Path, cwd: Path, args: list[str], answers: list[tuple[str, str]]) -> str:
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required")
    process = PtyProcess.spawn([node, str(binary), *args], cwd=str(cwd), dimensions=(40, 140))
    chunks: queue.Queue[str | Exception] = queue.Queue()

    def read_output() -> None:
        try:
            while True:
                text = process.read()
                if text:
                    chunks.put(text)
                else:
                    return
        except EOFError:
            return
        except Exception as error:
            chunks.put(error)

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    transcript = ""

    def expect(marker: str) -> None:
        nonlocal transcript
        deadline = time.monotonic() + 30
        while marker not in transcript:
            if time.monotonic() > deadline:
                raise AssertionError(f"Timed out waiting for {marker!r}\n{transcript}")
            try:
                chunk = chunks.get(timeout=0.1)
            except queue.Empty:
                continue
            if isinstance(chunk, Exception):
                raise chunk
            transcript += chunk

    try:
        for marker, answer in answers:
            expect(marker)
            process.write(answer if answer == "\x03" else answer + "\r")
        deadline = time.monotonic() + 30
        while process.isalive() and time.monotonic() < deadline:
            time.sleep(0.05)
        if process.isalive():
            raise AssertionError(f"Terminal process did not exit\n{transcript}")
        reader.join(timeout=2)
        while not chunks.empty():
            chunk = chunks.get_nowait()
            if isinstance(chunk, str):
                transcript += chunk
        return transcript
    finally:
        process.close(force=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, default=Path(__file__).resolve().parents[1] / "bin" / "hypercode-init.js")
    binary = parser.parse_args().binary.resolve()
    if os.name != "nt":
        raise RuntimeError("This check uses Windows pywinpty; run unit tests on other platforms")
    with tempfile.TemporaryDirectory(prefix="hypercode-terminal-") as directory:
        root = Path(directory)
        confirmed = scenario(binary, root, [], [
            ("Project name: ", "Bad Name"),
            ("Please try again:", "sample"),
            ("Destination [sample]: ", ""),
            ("Layout (1/single, 2/monorepo)", "2"),
            ("Stack selection: ", "react,fastapi"),
            ("Agent skills (number/id)", "4"),
            ("Create these files?", "yes"),
        ])
        assert "Review your setup" in confirmed and "Next steps:" in confirmed
        pkg = json.loads((root / "sample" / "package.json").read_text())
        assert pkg["workspaces"] == ["apps/web"]
        assert (root / "sample/apps/api/src/sample_fastapi/main.py").exists()
        assert not (root / "sample/.claude/skills/hypercode-tauri/SKILL.md").exists()
        assert (root / "sample/.claude/skills/hypercode-react/SKILL.md").exists()
        assert not (root / "sample/.github/skills").exists()
        declined = scenario(binary, root, ["declined"], [
            ("Layout (1/single, 2/monorepo)", ""),
            ("Stack selection: ", "4"),
            ("Agent skills (number/id)", "copilot"),
            ("Create these files?", ""),
        ])
        assert "No files were written" in declined
        assert not (root / "declined").exists()
        cancelled = scenario(binary, root, [], [("Project name: ", "\x03")])
        assert "Cancelled before generation" in cancelled
        assert sorted(child.name for child in root.iterdir()) == ["sample"]
        preview = scenario(binary, root, ["preview", "--dry-run"], [
            ("Layout (1/single, 2/monorepo)", ""),
            ("Stack selection: ", "4"),
            ("Agent skills (number/id)", ""),
        ])
        assert "Dry run: preview only" in preview
        assert not (root / "preview").exists()
        existing = root / "existing"
        existing.mkdir()
        (existing / "README.md").write_text("# User project")
        flags = ["skills", "add", str(existing), "--agent", "all", "--presets", "electron,tauri"]
        denied = scenario(binary, root, flags, [("Install these skills?", "")])
        assert "No files were written" in denied
        assert sorted(child.name for child in existing.iterdir()) == ["README.md"]
        created = scenario(binary, root, flags, [("Install these skills?", "yes")])
        assert "8 new files" in created
        assert (existing / ".claude/skills/hypercode-electron/SKILL.md").exists()
        assert (existing / ".claude/skills/hypercode-tauri/SKILL.md").exists()
        assert (existing / "README.md").read_text() == "# User project"
    print("Actual Windows terminal passed wizard Agent Skills, invalid input, default-no, Ctrl+C, dry-run and existing-project installation checks.")


if __name__ == "__main__":
    main()
