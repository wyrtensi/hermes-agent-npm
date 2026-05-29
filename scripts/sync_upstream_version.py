#!/usr/bin/env python3
import json
import sys
import urllib.request
from pathlib import Path

PYPI_PROJECT_URL = "https://pypi.org/pypi/hermes-agent/json"
PACKAGE_JSON = Path("package.json")


def fetch_pypi_project():
    with urllib.request.urlopen(PYPI_PROJECT_URL, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))["info"]


def main():
    project = fetch_pypi_project()
    version = project["version"]
    description = project.get("summary") or "Hermes Agent from NousResearch/Hermes-Agent."

    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    package["version"] = version
    package["description"] = f"Unofficial npm bridge for Hermes Agent {version}: {description}"
    package.setdefault("hermesAgent", {})["pythonPackageVersion"] = version
    package["hermesAgent"]["upstreamRepository"] = "nousresearch/hermes-agent"

    PACKAGE_JSON.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    print(f"version={version}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Failed to sync upstream version: {error}", file=sys.stderr)
        sys.exit(1)
