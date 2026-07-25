"""Normalize generated exercise guide sources into identical production assets."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageStat

OUTPUT_SIZE = (960, 640)
TARGET_RATIO = OUTPUT_SIZE[0] / OUTPUT_SIZE[1]


def center_crop(image: Image.Image) -> Image.Image:
    width, height = image.size
    ratio = width / height
    if abs(ratio - TARGET_RATIO) < 0.0001:
        return image
    if ratio > TARGET_RATIO:
        cropped_width = round(height * TARGET_RATIO)
        left = (width - cropped_width) // 2
        return image.crop((left, 0, left + cropped_width, height))
    cropped_height = round(width / TARGET_RATIO)
    top = (height - cropped_height) // 2
    return image.crop((0, top, width, top + cropped_height))


def normalize(source: Path, output: Path) -> None:
    with Image.open(source) as opened:
        image = center_crop(opened.convert("RGB"))
        image = image.resize(OUTPUT_SIZE, Image.Resampling.LANCZOS)

        # Catch accidental blank/transparent generations before they ship.
        brightness = ImageStat.Stat(image.convert("L")).mean[0]
        if brightness < 2 or brightness > 250:
            raise ValueError(f"{source.name}: suspicious mean brightness {brightness:.1f}")

        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, "WEBP", quality=91, method=6, exact=True)

    with Image.open(output) as checked:
        if checked.size != OUTPUT_SIZE or checked.format != "WEBP":
            raise ValueError(f"{output.name}: normalization verification failed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "source_dir",
        type=Path,
        nargs="?",
        default=Path("exercise-guides.local/sources"),
    )
    parser.add_argument(
        "output_dir",
        type=Path,
        nargs="?",
        default=Path("public/exercise-guides"),
    )
    args = parser.parse_args()

    sources = sorted(args.source_dir.glob("*.png"))
    if not sources:
        raise SystemExit(f"No PNG sources found in {args.source_dir}")

    for source in sources:
        output = args.output_dir / f"{source.stem}.webp"
        normalize(source, output)
        print(f"{source.name} -> {output.name} ({OUTPUT_SIZE[0]}x{OUTPUT_SIZE[1]})")


if __name__ == "__main__":
    main()
