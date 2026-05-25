#!/usr/bin/env python3
import json
import sys
import tomllib
import urllib.request
from pathlib import Path

UPSTREAM_PYPROJECT_URL = "https://raw.githubusercontent.com/nousresearch/hermes-agent/main/pyproject.toml"
PACKAGE_JSON = Path("package.json")


def fetch_upstream_project():
    with urllib.request.urlopen(UPSTREAM_PYPROJECT_URL, timeout=30) as response:
        return tomllib.loads(response.read().decode("utf-8"))["project"]


def main():
    project = fetch_upstream_project()
    version = project["version"]
    description = project.get("description", "Hermes Agent from NousResearch/Hermes-Agent.")

    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    package["version"] = version
    package["description"] = f"npm bridge for Hermes Agent {version}: {description}"
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
