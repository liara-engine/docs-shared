import re
import pathlib

def get_content(val_obj, module_dir):
    is_file_explicit = False
    value = ""

    if isinstance(val_obj, str):
        value = val_obj
    else:
        value = val_obj.get("value", "")
        is_file_explicit = val_obj.get("is-file", False)

    path = pathlib.Path(value)
    if path.exists() and path.is_file():
        return path.read_text(encoding='utf-8')

    if is_file_explicit:
        print(f"    WARNING: File for replacement not found: {value}")
        return None

    return value

def apply_to_file(file_path, pattern, replacement, options):
    print(f"        Applying to file: {file_path.relative_to(file_path.parent)}")
    content = file_path.read_text(encoding='utf-8')
    is_regex = pattern.startswith("regex^")
    search_pattern = pattern[6:] if is_regex else re.escape(pattern)

    count = 0
    if options.get("only-first-occurrence"): count = 1

    if options.get("only-last-occurrence") and not options.get("only-first-occurrence"):
        content = re.sub(search_pattern[::-1], replacement[::-1], content[::-1], count=1)
        content = content[::-1]
    else:
        content = re.sub(search_pattern, replacement, content, count=count)

    file_path.write_text(content, encoding='utf-8')

def handle_replacements(replacements, module_dir, manifest_name):
    print("    Applying replacements...")

    all_files = [f for f in module_dir.rglob("*") if f.is_file() and f.name != manifest_name]

    for pattern, config in replacements.items():
        options = config if isinstance(config, dict) else {}
        replacement_text = get_content(config, module_dir)
        print(f"    Replacement pattern: '{pattern}' -> '{replacement_text[:30]}...'")

        if replacement_text is None:
            continue

        for file_path in all_files:
            rel_path = str(file_path.relative_to(module_dir))

            only = options.get("only-in-files", [])
            exclude = options.get("exclude-files", [])

            if only and rel_path not in only: continue
            if exclude and rel_path in exclude: continue

            apply_to_file(file_path, pattern, replacement_text, options)