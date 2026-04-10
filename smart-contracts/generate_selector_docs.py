import os
import subprocess
import re
import json
import argparse

parser = argparse.ArgumentParser(description="Generate selector documentation for solidity contracts.")
parser.add_argument("--format", choices=["md", "json"], required=True, help="Output format: md or json")
parser.add_argument("--out", required=True, help="Output path")

args = parser.parse_args()
OUTPUT_FORMAT = args.format
OUTPUT_PATH = args.out



for root, _, files in os.walk("src"):
    for file in files:
        if file.endswith(".sol"):
            name = os.path.splitext(file)[0]
            relative_path = os.path.relpath(os.path.join(root, file))
            print(f"Parsing: {relative_path}")
            artifact_path = f"out/{name}.sol/{name}.json"

            if not os.path.exists(artifact_path):
                print(f"Skipping: {relative_path} – no artifact found")
                continue

            output_path = f"{OUTPUT_PATH}{name}.{OUTPUT_FORMAT}"
            data = []
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            try:
                result = subprocess.run(
                    ["forge", "inspect", relative_path, "abi"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                    text=True
                )
                lines = result.stdout.splitlines()
                wrote_header = False

                with open(output_path, "w", encoding="utf-8") as f:
                    if OUTPUT_FORMAT == "md":
                        f.write(f"### {name}\n\n")

                    for line in lines:
                        if line.startswith("╭") or line.startswith("╰") or line.startswith("+"):
                            continue

                        if re.match(r"^\|\s*Type\s*\|\s*Signature\s*\|\s*Selector\s*\|", line):
                            wrote_header = True
                            if OUTPUT_FORMAT == "md":
                                f.write("| Type | Signature | Selector |\n")
                                f.write("|------|-----------|----------|\n")
                            continue

                        if wrote_header and re.match(r"^\|\s", line):
                            match = re.match(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|", line)
                            if match:
                                entry = {
                                    "type": match[1].strip(),
                                    "signature": match[2].strip(),
                                    "selector": match[3].strip()
                                }
                                data.append(entry)
                                if OUTPUT_FORMAT == "md":
                                    f.write(f"| {entry['type']} | {entry['signature']} | {entry['selector']} |\n")

                    if OUTPUT_FORMAT == "json":
                        json.dump(data, f, indent=2)

            except subprocess.CalledProcessError as e:
                print(f"Error inspecting: {relative_path}: {e.stderr.strip()}")
