#!/usr/bin/env bash

out="$1"

if [[ -z "$out" ]]; then
    echo "Usage: $0 <output_directory>"
    exit 1
fi

if [[ ! -d "$out" ]]; then
    echo "Error: output destination '$out' is not a directory or does not exist!" >&2
    exit 1
fi

export-abi() {
    file=$(basename "$1")
    filename="${file%.sol}"
    json="./out/$file/$filename.json"

    if [[ ! -e "$json" ]]; then
        echo "Warning: for file '$1' json '$json' doesn't exist!" >&2
        return
    fi

    abi=$(jq '.abi' "$json")
    ts="export const $filename = $abi as const;"
    echo "$ts" >"$out/$filename.ts"

    echo " - exported '$filename' to '$out/$filename.ts'"
}

readarray -d '' files < <(find ./src/ -type f -print0)
echo "Exporting ${#files[@]} files to $out..."

for f in "${files[@]}"; do
    export-abi "$f"
done
