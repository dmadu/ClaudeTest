"""Validation and storage of uploaded record images."""

import io
import os
import uuid

from flask import current_app
from PIL import Image, ImageFile

MAX_IMAGE_BYTES = 5 * 1024 * 1024
# Headroom for the text fields and multipart framing around the image.
MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024

# Checked before decoding, so a small file that expands to a huge picture is refused up front.
MAX_PIXELS = 50_000_000

SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", ".png", "PNG"),
    (b"\xff\xd8\xff", ".jpg", "JPEG"),
)

ImageFile.LOAD_TRUNCATED_IMAGES = False


def upload_folder():
    return os.path.abspath(current_app.config["UPLOAD_FOLDER"])


def read_image(file, errors):
    """Return (bytes, extension) for a valid JPEG/PNG upload, or None with errors["image"] set.

    The type comes from the file's own bytes, never from the client's file name or MIME type.
    """
    data = file.stream.read(MAX_IMAGE_BYTES + 1)
    if not data:
        errors["image"] = "The image file is empty."
        return None
    if len(data) > MAX_IMAGE_BYTES:
        errors["image"] = "Image must be 5 MB or smaller."
        return None
    for signature, extension, image_format in SIGNATURES:
        if data.startswith(signature):
            problem = _decode_problem(data, image_format)
            if problem:
                errors["image"] = problem
                return None
            return data, extension
    errors["image"] = "Image must be a JPEG or PNG file."
    return None


def _decode_problem(data, expected_format):
    """Fully decode the picture. Returns a message if it is not a sound image, else None."""
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format != expected_format:
                return "Image must be a JPEG or PNG file."
            width, height = probe.size
            if width * height > MAX_PIXELS:
                return "Image dimensions are too large (50 megapixels at most)."
        with Image.open(io.BytesIO(data)) as img:
            img.load()
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError, Image.UnidentifiedImageError):
        return "The image file is damaged or could not be read."
    return None


def save_image(data, extension):
    """Write the image under a random name and return that name."""
    folder = upload_folder()
    os.makedirs(folder, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    with open(os.path.join(folder, filename), "wb") as fh:
        fh.write(data)
    return filename


def remove_image(filename):
    """Delete a stored image. A missing file is not an error."""
    if not filename:
        return
    folder = upload_folder()
    path = os.path.abspath(os.path.join(folder, filename))
    if os.path.dirname(path) != folder:
        current_app.logger.warning("Refusing to delete outside the upload folder: %r", filename)
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        current_app.logger.exception("Could not delete image %s", filename)
