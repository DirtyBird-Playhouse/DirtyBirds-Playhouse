"""GAN face-restoration backend for The Fixer (GFPGAN / CodeFormer).

These are dedicated face-restoration networks loaded through **spandrel** — the
same architecture loader ComfyUI already bundles for upscale models — so we avoid
the fragile ``basicsr`` / ``gfpgan`` pip stack entirely.

GFPGAN and RestoreFormer live in spandrel's main registry; CodeFormer ships in
the separate ``spandrel_extra_arches`` package (see requirements.txt). Models are
downloaded on first use into ``models/facerestore_models`` from the canonical
upstream release assets.

The models expect a face warped to a canonical 512x512 template. Each crop is
landmark-aligned with facexlib's ``FaceRestoreHelper`` before the GAN and the
result is warped back into place (the same approach the upstream GFPGAN /
CodeFormer repos use), so angled or loosely-cropped faces restore correctly. If
no landmarks are detected the crop is restored unaligned as a fallback.
"""

import os
import numpy as np
import torch
import torch.nn.functional as F
import folder_paths
import comfy.model_management as model_management

from .utils import check_for_interruption

# Method label -> download spec. ``arch`` is only documentation here; spandrel
# auto-detects the architecture from the checkpoint.
FACE_RESTORE_MODELS = {
    "GFPGAN": {
        "filename": "GFPGANv1.4.pth",
        "url": "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth",
        "keyword": "gfpgan",
        "arch": "GFPGAN",
    },
    "CodeFormer": {
        "filename": "codeformer.pth",
        "url": "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth",
        "keyword": "codeformer",
        "arch": "CodeFormer",
    },
}

# Methods that need spandrel_extra_arches registered before load.
_EXTRA_ARCH_METHODS = {"CodeFormer"}

_FOLDER = "facerestore_models"


def register_folder():
    """Make ``models/facerestore_models`` known to folder_paths (idempotent)."""
    try:
        model_dir = os.path.join(folder_paths.models_dir, _FOLDER)
        os.makedirs(model_dir, exist_ok=True)
        if _FOLDER in folder_paths.folder_names_and_paths:
            paths, exts = folder_paths.folder_names_and_paths[_FOLDER]
            if model_dir not in paths:
                paths.append(model_dir)
        else:
            folder_paths.folder_names_and_paths[_FOLDER] = (
                [model_dir],
                {".pth", ".safetensors", ".ckpt", ".bin"},
            )
    except Exception as exc:  # noqa: BLE001 - never block node load
        print(f"[Fixer] Could not register {_FOLDER} folder: {exc}")


register_folder()


def _extra_arches_registered():
    """Register spandrel_extra_arches once so CodeFormer becomes loadable."""
    if getattr(_extra_arches_registered, "_done", False):
        return True
    try:
        from spandrel import MAIN_REGISTRY
        from spandrel_extra_arches import EXTRA_REGISTRY
    except ImportError as exc:
        print(f"[Fixer] spandrel_extra_arches unavailable ({exc}).")
        return False

    try:
        MAIN_REGISTRY.add(*EXTRA_REGISTRY)
    except Exception as exc:  # noqa: BLE001
        # ComfyUI registers the extra arches at startup, so a second add here
        # raises DuplicateArchitectureError. That just means the arches (incl.
        # CodeFormer) are already present, which is exactly what we need.
        print(f"[Fixer] spandrel_extra_arches already registered ({exc}); continuing.")

    _extra_arches_registered._done = True
    return True


class FaceRestoreManager:
    """Loads and runs GFPGAN / CodeFormer face-restore models via spandrel."""

    _instance = None

    def __init__(self):
        self._descriptors = {}  # method -> spandrel ImageModelDescriptor
        self._helper = None     # cached facexlib FaceRestoreHelper (landmark align)
        self._helper_failed = False

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _resolve_model_path(self, method):
        spec = FACE_RESTORE_MODELS[method]
        filename = spec["filename"]

        existing = folder_paths.get_full_path(_FOLDER, filename)
        if existing and os.path.exists(existing):
            return existing

        model_dir = os.path.join(folder_paths.models_dir, _FOLDER)
        os.makedirs(model_dir, exist_ok=True)
        local_path = os.path.join(model_dir, filename)
        if os.path.exists(local_path) and os.path.getsize(local_path) > 1000:
            return local_path

        # Reuse any already-present checkpoint for this method (e.g. a
        # differently-named codeformer-v0.1.0.pth) before downloading.
        keyword = spec.get("keyword", "").lower()
        if keyword:
            for candidate in sorted(folder_paths.get_filename_list(_FOLDER) or []):
                if keyword in candidate.lower():
                    found = folder_paths.get_full_path(_FOLDER, candidate)
                    if found and os.path.exists(found):
                        print(f"[Fixer] Using existing {method} model: {candidate}")
                        return found

        print(f"[Fixer] Downloading {method} model ({filename})...")
        self._download(spec["url"], local_path, method)
        if os.path.exists(local_path) and os.path.getsize(local_path) > 1000:
            print(f"[Fixer] {method} model ready.")
            return local_path
        return None

    @staticmethod
    def _download(url, dest, label):
        import urllib.request

        tmp = dest + ".part"
        try:
            last = [-1]

            def hook(block, block_size, total):
                if total <= 0:
                    return
                pct = int(block * block_size * 100 / total)
                if pct > last[0]:
                    last[0] = pct
                    print(f"  {label}: {min(pct, 100)}%", end="\r")

            urllib.request.urlretrieve(url, tmp, reporthook=hook)
            os.replace(tmp, dest)
            print()
        except Exception as exc:  # noqa: BLE001
            print(f"\n[Fixer] Download failed for {label}: {exc}")
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

    def load(self, method):
        if method in self._descriptors:
            descriptor = self._descriptors[method]
            try:
                descriptor.to(model_management.get_torch_device())
            except Exception:
                pass
            return descriptor

        if method in _EXTRA_ARCH_METHODS and not _extra_arches_registered():
            raise RuntimeError(
                "CodeFormer needs the 'spandrel_extra_arches' package. Run "
                "`pip install -r requirements.txt` in the DirtyBirds-Playhouse folder."
            )

        model_path = self._resolve_model_path(method)
        if not model_path:
            raise RuntimeError(
                f"Could not obtain the {method} model. Place its checkpoint in "
                f"models/{_FOLDER} or check your internet connection."
            )

        from spandrel import ModelLoader, ImageModelDescriptor

        descriptor = ModelLoader().load_from_file(model_path)
        if not isinstance(descriptor, ImageModelDescriptor):
            raise RuntimeError(
                f"{method}: spandrel loaded an unexpected model type "
                f"({type(descriptor).__name__})."
            )
        descriptor.to(model_management.get_torch_device()).eval()
        self._descriptors[method] = descriptor
        print(f"[Fixer] Loaded {method} via spandrel "
              f"({descriptor.architecture.name}).")
        return descriptor

    def _get_helper(self):
        """Lazily build a facexlib FaceRestoreHelper for landmark alignment.

        The helper detects 5 facial landmarks and warps each face to the
        canonical 512 template the GANs are trained on — without it, angled or
        loosely-cropped faces get their eyes/mouth rebuilt in the wrong place.
        Detection/parsing weights download once into ``models/facexlib``.
        """
        if self._helper is not None or self._helper_failed:
            return self._helper
        try:
            from facexlib.utils.face_restoration_helper import FaceRestoreHelper

            root = os.path.join(folder_paths.models_dir, "facexlib")
            os.makedirs(root, exist_ok=True)
            self._helper = FaceRestoreHelper(
                upscale_factor=1,
                face_size=512,
                crop_ratio=(1, 1),
                det_model="retinaface_resnet50",
                use_parse=True,
                device=model_management.get_torch_device(),
                model_rootpath=root,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[Fixer] Landmark alignment unavailable ({exc}); "
                  f"using unaligned restore.")
            self._helper_failed = True
            self._helper = None
        return self._helper

    def _run_gan(self, descriptor, x512, method, codeformer_fidelity):
        """Run one aligned 512x512 crop (tensor [1,3,512,512] in [0,1]) through
        the GAN. Returns [1,3,512,512] in [0,1] on the model device."""
        if method == "CodeFormer":
            out = self._run_codeformer(descriptor, x512, codeformer_fidelity)
        else:
            out = descriptor(x512)
        return out.clamp(0.0, 1.0)

    @torch.no_grad()
    def restore(self, face_bhwc, method, codeformer_fidelity=0.5):
        """Restore a face crop. ``face_bhwc`` is [B,H,W,3] in [0,1]; returns the
        same layout/size. Each image is landmark-aligned before the GAN and the
        result is warped back into place; if no face landmarks are found the
        crop is restored unaligned. On load failure the input is returned as-is."""
        check_for_interruption()
        try:
            descriptor = self.load(method)
        except Exception as exc:  # noqa: BLE001
            print(f"[Fixer] Face restore ({method}) unavailable: {exc}")
            return face_bhwc

        device = model_management.get_torch_device()
        helper = self._get_helper()

        outputs = []
        for b in range(int(face_bhwc.shape[0])):
            img_hwc = face_bhwc[b].to(device).float().clamp(0.0, 1.0)
            out_hwc = None
            if helper is not None:
                try:
                    out_hwc = self._restore_aligned(
                        helper, descriptor, img_hwc, method, codeformer_fidelity)
                except model_management.InterruptProcessingException:
                    raise
                except Exception as exc:  # noqa: BLE001
                    print(f"[Fixer] Aligned restore failed ({exc}); "
                          f"falling back to unaligned.")
                    out_hwc = None
            if out_hwc is None:
                try:
                    out_hwc = self._restore_naive(
                        descriptor, img_hwc, method, codeformer_fidelity)
                except model_management.InterruptProcessingException:
                    raise
                except Exception as exc:  # noqa: BLE001
                    print(f"[Fixer] {method} inference failed: {exc}. "
                          f"Keeping original face.")
                    out_hwc = img_hwc
            outputs.append(out_hwc.to(device))
        return torch.stack(outputs, dim=0)

    def _restore_naive(self, descriptor, img_hwc, method, codeformer_fidelity):
        """Unaligned path: resize the whole crop to 512, run the GAN, resize
        back. Used when no landmarks are found or facexlib is unavailable."""
        orig_h, orig_w = int(img_hwc.shape[0]), int(img_hwc.shape[1])
        x = img_hwc.permute(2, 0, 1).unsqueeze(0)
        x512 = F.interpolate(x, size=(512, 512), mode="bilinear",
                             align_corners=False, antialias=True).contiguous()
        out = self._run_gan(descriptor, x512, method, codeformer_fidelity)
        if out.shape[2:] != (orig_h, orig_w):
            out = F.interpolate(out, size=(orig_h, orig_w), mode="bicubic",
                                align_corners=False, antialias=True).clamp(0.0, 1.0)
        return out.squeeze(0).permute(1, 2, 0)

    def _restore_aligned(self, helper, descriptor, img_hwc, method,
                         codeformer_fidelity):
        """Landmark-aligned path. Returns an HWC tensor in [0,1], or ``None`` if
        no face landmarks are detected (caller falls back to the naive path)."""
        device = img_hwc.device
        # facexlib works in BGR uint8 (OpenCV convention).
        rgb_u8 = (img_hwc.cpu().numpy() * 255.0).round().astype(np.uint8)
        bgr_u8 = rgb_u8[:, :, ::-1].copy()

        helper.clean_all()
        helper.read_image(bgr_u8)
        num_faces = helper.get_face_landmarks_5(
            only_center_face=False, resize=640, eye_dist_threshold=5)
        if not num_faces:
            return None

        helper.align_warp_face()
        for cropped_face in helper.cropped_faces:
            check_for_interruption()
            face_rgb = cropped_face[:, :, ::-1].astype(np.float32) / 255.0
            x512 = torch.from_numpy(np.ascontiguousarray(face_rgb)) \
                .permute(2, 0, 1).unsqueeze(0).to(device)
            out = self._run_gan(descriptor, x512, method, codeformer_fidelity)
            restored_rgb = out.squeeze(0).permute(1, 2, 0).cpu().numpy()
            restored_bgr = (restored_rgb[:, :, ::-1] * 255.0).round() \
                .astype(np.uint8)
            helper.add_restored_face(restored_bgr.copy())

        helper.get_inverse_affine()
        pasted_bgr = helper.paste_faces_to_input_image()  # same HxW as input
        pasted_rgb = pasted_bgr[:, :, ::-1].astype(np.float32) / 255.0
        return torch.from_numpy(np.ascontiguousarray(pasted_rgb)).to(device)

    @staticmethod
    def _run_codeformer(descriptor, x512, fidelity):
        """CodeFormer's fidelity weight isn't exposed on descriptor.__call__, so
        drive the underlying model directly, falling back to the plain call."""
        fidelity = float(max(0.0, min(1.0, fidelity)))
        model = descriptor.model
        # spandrel_extra_arches CodeFormer.forward is (x, weight=0.5, **kwargs).
        try:
            result = model(x512, weight=fidelity)
        except TypeError:
            try:
                result = model(x512, fidelity)
            except Exception:
                return descriptor(x512)
        if isinstance(result, (tuple, list)):
            result = result[0]
        return result

    def offload_to_cpu(self):
        for method, descriptor in self._descriptors.items():
            try:
                descriptor.to("cpu")
            except Exception as exc:  # noqa: BLE001
                print(f"[Fixer] Could not offload {method}: {exc}")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def clear_cache(self):
        self._descriptors.clear()
        self._helper = None
        self._helper_failed = False
