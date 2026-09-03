"""Collate variable-resolution sampler results into one ComfyUI batch.

Cycler entries are evaluated independently.  When Loader resolution is random,
those entries can legitimately produce different spatial shapes.  PyTorch
cannot concatenate those tensors until they share a canvas, so we center-pad
them to the largest height and width without resizing generated content.
"""

import torch


def _center_pad(tensor, target_height, target_width, height_dim, width_dim):
    height = int(tensor.shape[height_dim])
    width = int(tensor.shape[width_dim])
    if height == target_height and width == target_width:
        return tensor

    shape = list(tensor.shape)
    shape[height_dim] = target_height
    shape[width_dim] = target_width
    result = tensor.new_zeros(shape)
    top = (target_height - height) // 2
    left = (target_width - width) // 2
    slices = [slice(None)] * tensor.ndim
    slices[height_dim] = slice(top, top + height)
    slices[width_dim] = slice(left, left + width)
    result[tuple(slices)] = tensor
    return result


def collate_spatial_batch(parts, *, layout):
    """Center-pad and concatenate tensors using BCHW or BHWC layout."""
    if not parts:
        raise ValueError("cannot collate an empty tensor list")
    if layout == "BCHW":
        height_dim, width_dim = 2, 3
    elif layout == "BHWC":
        height_dim, width_dim = 1, 2
    else:
        raise ValueError(f"unsupported tensor layout: {layout}")

    target_height = max(int(part.shape[height_dim]) for part in parts)
    target_width = max(int(part.shape[width_dim]) for part in parts)
    padded = [
        _center_pad(part, target_height, target_width, height_dim, width_dim)
        for part in parts
    ]
    return torch.cat(padded, dim=0)
