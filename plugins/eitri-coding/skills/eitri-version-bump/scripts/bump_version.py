#!/usr/bin/env python3
"""
Bump the semver version in an eitri-app.conf.js file.

Usage:
    python3 bump_version.py <patch|minor|major> [path/to/eitri-app.conf.js] [--message "description"]

If no path is given, searches for eitri-app.conf.js in the current directory
and up to 2 levels of subdirectories.

Options:
    --message, -m    Version message describing the changes (updates versionMessage field)
"""

import re
import sys
import os
import glob

SEMVER_RE = re.compile(
    r"""(version\s*:\s*['"])(\d+)\.(\d+)\.(\d+)(['"])"""
)

VERSION_MSG_RE = re.compile(
    r"""(versionMessage\s*:\s*['"])([^'"]*)(['"])"""
)


def find_conf_files(root: str) -> list[str]:
    """Find all eitri-app.conf.js files under root (max depth 2)."""
    patterns = [
        os.path.join(root, "eitri-app.conf.js"),
        os.path.join(root, "*", "eitri-app.conf.js"),
        os.path.join(root, "*", "*", "eitri-app.conf.js"),
    ]
    results = []
    for pattern in patterns:
        results.extend(glob.glob(pattern))
    # Exclude node_modules
    return [r for r in results if "node_modules" not in r]


def bump(content: str, level: str) -> tuple[str, str, str]:
    """
    Bump the version in file content.
    Returns (new_content, old_version, new_version).
    """
    match = SEMVER_RE.search(content)
    if not match:
        raise ValueError("No semver version found in file")

    prefix, major, minor, patch, suffix = match.groups()
    major, minor, patch = int(major), int(minor), int(patch)
    old_version = f"{major}.{minor}.{patch}"

    if level == "patch":
        patch += 1
    elif level == "minor":
        minor += 1
        patch = 0
    elif level == "major":
        major += 1
        minor = 0
        patch = 0
    else:
        raise ValueError(f"Unknown bump level: {level}")

    new_version = f"{major}.{minor}.{patch}"
    new_content = SEMVER_RE.sub(
        f"{prefix}{new_version}{suffix}", content, count=1
    )
    return new_content, old_version, new_version


def set_version_message(content: str, message: str) -> str:
    """
    Update or insert the versionMessage field in eitri-app.conf.js.
    If the field exists, update it. If not, insert it after the version line.
    """
    match = VERSION_MSG_RE.search(content)
    if match:
        # Update existing versionMessage
        prefix, _, suffix = match.groups()
        return VERSION_MSG_RE.sub(f"{prefix}{message}{suffix}", content, count=1)
    else:
        # Insert versionMessage after the version line
        version_match = SEMVER_RE.search(content)
        if not version_match:
            return content
        end_pos = version_match.end()
        # Find the end of the version line (next comma or newline)
        rest = content[end_pos:]
        # Detect the quote style used in version
        quote = version_match.group(5)  # ' or "
        # Detect indentation from the version line
        line_start = content.rfind("\n", 0, version_match.start()) + 1
        indent = ""
        for ch in content[line_start:]:
            if ch in (" ", "\t"):
                indent += ch
            else:
                break
        # Insert after the comma following the version value
        comma_pos = rest.find(",")
        if comma_pos != -1:
            insert_pos = end_pos + comma_pos + 1
            newline_after_comma = rest[comma_pos + 1 : comma_pos + 2]
            if newline_after_comma == "\n":
                # Insert on the next line with same indentation
                return (
                    content[: insert_pos + 1]
                    + f"{indent}versionMessage: {quote}{message}{quote},\n"
                    + content[insert_pos + 1 :]
                )
            else:
                return (
                    content[:insert_pos]
                    + f"\n{indent}versionMessage: {quote}{message}{quote},"
                    + content[insert_pos:]
                )
        else:
            # No comma — insert after the version value on a new line
            return (
                content[:end_pos]
                + f",\n{indent}versionMessage: {quote}{message}{quote}"
                + content[end_pos:]
            )


def parse_args(argv: list[str]) -> tuple[str, list[str], str | None]:
    """
    Parse command-line arguments.
    Returns (level, files, message).
    """
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        sys.exit(0)

    level = argv[1].lower()
    if level not in ("patch", "minor", "major"):
        print(f"Error: level must be patch, minor, or major (got '{level}')")
        sys.exit(1)

    files = []
    message = None
    i = 2
    while i < len(argv):
        if argv[i] in ("--message", "-m"):
            if i + 1 < len(argv):
                message = argv[i + 1]
                i += 2
            else:
                print("Error: --message requires a value")
                sys.exit(1)
        else:
            files.append(argv[i])
            i += 1

    if not files:
        files = find_conf_files(os.getcwd())

    return level, files, message


def main():
    level, files, message = parse_args(sys.argv)

    if not files:
        print("Error: no eitri-app.conf.js found")
        sys.exit(1)

    for filepath in files:
        with open(filepath, "r") as f:
            content = f.read()
        try:
            new_content, old_ver, new_ver = bump(content, level)
        except ValueError as e:
            print(f"Skipping {filepath}: {e}")
            continue

        if message:
            new_content = set_version_message(new_content, message)
            print(f"✅ {filepath}: {old_ver} → {new_ver} | versionMessage: {message}")
        else:
            print(f"✅ {filepath}: {old_ver} → {new_ver}")

        with open(filepath, "w") as f:
            f.write(new_content)


if __name__ == "__main__":
    main()
