import shutil
import pathlib

def copy_single_file(source_str, target_dir, target_name=None):
    source_path = pathlib.Path(source_str)

    if not source_path.exists():
        print(f"    WARNING: Resource file not found: {source_str}")
        return
    if not source_path.is_file():
        print(f"    WARNING: Path exists but is not a file: {source_str}")
        return

    name = target_name if target_name else source_path.name
    dest_path = target_dir / name

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, dest_path)
    print(f"    Copied {source_path.name} to {dest_path.relative_to(target_dir.parent)}")

def process_unspecified_resource(res_entry, module_dir):
    if isinstance(res_entry, str):
        path_str = res_entry
        is_folder = False
        folder_depth = 1
        copy_name = None
    elif isinstance(res_entry, dict):
        path_str = res_entry.get("path", "")
        is_folder = res_entry.get("is-folder", False)
        folder_depth = res_entry.get("folder-depth", 1)
        copy_name = res_entry.get("copy-name")
    else:
        return

    source_path = pathlib.Path(path_str)

    if not source_path.exists():
        print(f"    WARNING: Unspecified resource path not found: {path_str}")
        return

    if not is_folder:
        if not source_path.is_file():
            print(f"    WARNING: Resource expected to be a file but is a directory: {path_str}")
            return
        copy_single_file(source_path, module_dir, target_name=copy_name)

    else:
        if not source_path.is_dir():
            print(f"    WARNING: Resource expected to be a directory but is a file: {path_str}")
            return

        base_dest_name = copy_name if copy_name else source_path.name
        target_base_dir = module_dir / base_dest_name

        copied_count = 0
        for file_path in source_path.rglob("*"):
            if not file_path.is_file():
                continue

            rel_to_source = file_path.relative_to(source_path)
            depth = len(rel_to_source.parts) - 1

            if folder_depth != -1 and depth > folder_depth:
                continue

            dest_file_path = target_base_dir / rel_to_source
            dest_file_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file_path, dest_file_path)
            copied_count += 1

        print(f"    Copied directory '{source_path.name}' to '{base_dest_name}' ({copied_count} files, max-depth: {folder_depth})")

def handle_resources(resources, module_dir):
    print("    Handling resources...")

    if "css" in resources:
        for src_str in resources["css"]:
            copy_single_file(src_str, module_dir / "css")

    if "js" in resources:
        for src_str in resources["js"]:
            copy_single_file(src_str, module_dir / "js")

    if "favicon-ico" in resources:
        copy_single_file(resources["favicon-ico"], module_dir, target_name="favicon.ico")

    if "favicon-svg" in resources:
        copy_single_file(resources["favicon-svg"], module_dir, target_name="favicon.svg")

    if "unspecified" in resources and isinstance(resources["unspecified"], dict):
        for custom_identifier, res_entry in resources["unspecified"].items():
            process_unspecified_resource(res_entry, module_dir)