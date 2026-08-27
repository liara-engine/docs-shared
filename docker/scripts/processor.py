import os
import json
import pathlib
import resource_processor
import replacement_processor

def main():
    print("==> Finding documentation modules (*.liaradoc.json)")

    manifests = list(pathlib.Path("/src").rglob("*.liaradoc.json"))

    if not manifests:
        print("    No modules found.")
        return

    for manifest_path in manifests:
        print(f"--> Processing module: {manifest_path}")
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                config = json.load(f)

            module_dir = manifest_path.parent

            if "resources" in config:
                resource_processor.handle_resources(config["resources"], module_dir)

            if "replacements" in config:
                replacement_processor.handle_replacements(config["replacements"], module_dir, manifest_path.name)

        except Exception as e:
            print(f"    ERROR processing {manifest_path}: {e}")

if __name__ == "__main__":
    main()