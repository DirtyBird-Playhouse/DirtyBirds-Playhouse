"""GAN face restoration (GFPGAN / CodeFormer) for the Inpainting node.

These are dedicated face-restoration networks loaded through **spandrel** — the
same architecture loader ComfyUI already bundles for upscale models — so we avoid
the fragile ``basicsr`` / ``gfpgan`` pip stack entirely.

GFPGAN and RestoreFormer live in spandrel's main registry; CodeFormer ships in
the separate ``spandrel_extra_arches`` package (see requirements.txt). Models are
downloaded on first use into ``models/facerestore_models`` from the canonical
upstream release assets.

The models expect a face warped to a canonical 512x512 template. facexlib's
``FaceRestoreHelper`` detects every face in the image, warps each to that
template, and inverse-warps the restored result back into place — the same
approach the upstream GFPGAN / CodeFormer repos use, so angled or off-centre
faces restore without distorting eyes and mouth. An image with no detected face
is returned untouched — running a face GAN over a whole faceless picture is not
a restore, it wrecks it.

This module is DirtyBirds' own code. It was written while the face restore lived
inside the retired Fixer node and is deliberately self-contained: no detector,
cropper or compositor beyond facexlib, and nothing from the pipe — no model, VAE
or conditioning. That is what let the Forbidden Vision vendor tree go.
"""

import os

import numpy as np
import torch
import torch.nn.functional as F

import folder_paths
import comfy.model_management as model_management

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

FACE_RESTORE_OFF = "Off"
FACE_RESTORE_OPTIONS = (FACE_RESTORE_OFF, *FACE_RESTORE_MODELS)


def check_for_interruption():
    """Raise if the user pressed Cancel in ComfyUI.

    Inlined from the retired vendor's utils so this module carries no Forbidden
    Vision dependency.
    """
    try:
        if hasattr(model_management, "processing_interrupted"):
            if model_management.processing_interrupted():
                raise model_management.InterruptProcessingException()
    except AttributeError:
        pass


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
        print(f"[DirtyBirds] Could not register {_FOLDER} folder: {exc}")


register_folder()


def _extra_arches_registered():
    """Register spandrel_extra_arches once so CodeFormer becomes loadable."""
    if getattr(_extra_arches_registered, "_done", False):
        return True
    try:
        from spandrel import MAIN_REGISTRY
        from spandrel_extra_arches import EXTRA_REGISTRY
    except ImportError as exc:
        print(f"[DirtyBirds] spandrel_extra_arches unavailable ({exc}).")
        return False

    try:
        MAIN_REGISTRY.add(*EXTRA_REGISTRY)
    except Exception as exc:  # noqa: BLE001
        # ComfyUI registers the extra arches at startup, so a second add here
        # raises DuplicateArchitectureError. That just means the arches (incl.
        # CodeFormer) are already present, which is exactly what we need.
        print(
            f"[DirtyBirds] spandrel_extra_arches already registered ({exc}); continuing."
        )

    _extra_arches_registered._done = True
    return True


# Sentinel: the face detector ran and found no faces. Distinct from None, which
# means the aligned path could not run at all. Collapsing the two is what let a
# faceless image reach the whole-image GAN and come back destroyed.
NO_FACES = object()


class FaceRestoreManager:
    """Loads and runs GFPGAN / CodeFormer face-restore models via spandrel."""

    _instance = None

    def __init__(self):
        self._descriptors = {}  # method -> spandrel ImageModelDescriptor
        self._helper = None  # cached facexlib FaceRestoreHelper (landmark align)
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
                        print(
                            f"[DirtyBirds] Using existing {method} model: {candidate}"
                        )
                        return found

        print(f"[DirtyBirds] Downloading {method} model ({filename})...")
        self._download(spec["url"], local_path, method)
        if os.path.exists(local_path) and os.path.getsize(local_path) > 1000:
            print(f"[DirtyBirds] {method} model ready.")
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
            print(f"\n[DirtyBirds] Download failed for {label}: {exc}")
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
        print(
            f"[DirtyBirds] Loaded {method} via spandrel "
            f"({descriptor.architecture.name})."
        )
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
            print(
                f"[DirtyBirds] Landmark alignment unavailable ({exc}); "
                f"using unaligned restore."
            )
            self._helper_failed = True
            self._helper = None
        return self._helper

    def _run_gan(self, descriptor, x512, method, codeformer_fidelity):
        """Run one aligned 512x512 crop (tensor [1,3,512,512] in [0,1]) through
        the GAN. Returns [1,3,512,512] in [0,1] on the model device."""
        if method == "CodeFormer":
            out = self._run_codeformer(descriptor, x512, codeformer_fidelity)
        elif method == "GFPGAN":
            out = self._run_gfpgan(descriptor, x512)
        else:
            out = descriptor(x512)
        return out.clamp(0.0, 1.0)

    @torch.no_grad()
    def restore(self, image_bhwc, method, codeformer_fidelity=0.5, align=True):
        """Restore every face in ``image_bhwc`` ([B,H,W,3] in [0,1]).

        Returns the same layout and size. Each face is landmark-detected,
        aligned, restored and warped back into the image.

        **A frame with no detected face is passed through untouched.** These are
        face GANs: the unaligned path squashes the whole picture to 512x512 and
        runs the model over all of it, which on a landscape or an object is not
        a restore, it is a hallucination that destroys the image. That fallback
        now applies only when landmark alignment is genuinely unavailable — a
        missing facexlib, or a detector that errored — never when the detector
        ran and honestly reported zero faces.

        On load failure the input is returned unchanged so a missing model never
        breaks the graph."""
        check_for_interruption()
        try:
            descriptor = self.load(method)
        except Exception as exc:  # noqa: BLE001
            print(f"[DirtyBirds] Face restore ({method}) unavailable: {exc}")
            return image_bhwc

        device = model_management.get_torch_device()
        helper = self._get_helper() if align else None

        outputs = []
        for b in range(int(image_bhwc.shape[0])):
            img_hwc = image_bhwc[b].to(device).float().clamp(0.0, 1.0)
            out_hwc = None
            if helper is not None:
                try:
                    out_hwc = self._restore_aligned(
                        helper, descriptor, img_hwc, method, codeformer_fidelity
                    )
                except model_management.InterruptProcessingException:
                    raise
                except Exception as exc:  # noqa: BLE001
                    print(
                        f"[DirtyBirds] Aligned restore failed ({exc}); "
                        f"falling back to unaligned."
                    )
                    out_hwc = None
            # The detector ran and found nothing. Pass the frame through rather
            # than running a face model over the whole picture.
            if out_hwc is NO_FACES:
                print(
                    f"[DirtyBirds] {method}: no face detected in frame {b}; "
                    f"image passed through unchanged."
                )
                outputs.append(img_hwc)
                continue
            if out_hwc is None:
                try:
                    out_hwc = self._restore_naive(
                        descriptor, img_hwc, method, codeformer_fidelity
                    )
                except model_management.InterruptProcessingException:
                    raise
                except Exception as exc:  # noqa: BLE001
                    print(
                        f"[DirtyBirds] {method} inference failed: {exc}. "
                        f"Keeping the original image."
                    )
                    out_hwc = img_hwc
            outputs.append(out_hwc.to(device))
        return torch.stack(outputs, dim=0)

    def _restore_naive(self, descriptor, img_hwc, method, codeformer_fidelity):
        """Unaligned path: resize the whole image to 512, run the GAN, resize
        back. Used when no landmarks are found or facexlib is unavailable."""
        orig_h, orig_w = int(img_hwc.shape[0]), int(img_hwc.shape[1])
        x = img_hwc.permute(2, 0, 1).unsqueeze(0)
        x512 = F.interpolate(
            x, size=(512, 512), mode="bilinear", align_corners=False, antialias=True
        ).contiguous()
        out = self._run_gan(descriptor, x512, method, codeformer_fidelity)
        if out.shape[2:] != (orig_h, orig_w):
            out = F.interpolate(
                out,
                size=(orig_h, orig_w),
                mode="bicubic",
                align_corners=False,
                antialias=True,
            ).clamp(0.0, 1.0)
        return out.squeeze(0).permute(1, 2, 0)

    def _restore_aligned(
        self, helper, descriptor, img_hwc, method, codeformer_fidelity
    ):
        """Landmark-aligned path. Returns an HWC tensor in [0,1], or ``NO_FACES``
        when the detector ran and found none.

        ``NO_FACES`` and ``None`` mean different things to the caller and must
        not be collapsed: no faces means leave the image alone, whereas a raised
        exception means try the unaligned path.
        """
        device = img_hwc.device
        # facexlib works in BGR uint8 (OpenCV convention).
        rgb_u8 = (img_hwc.cpu().numpy() * 255.0).round().astype(np.uint8)
        bgr_u8 = rgb_u8[:, :, ::-1].copy()

        helper.clean_all()
        helper.read_image(bgr_u8)
        num_faces = helper.get_face_landmarks_5(
            only_center_face=False, resize=640, eye_dist_threshold=5
        )
        if not num_faces:
            return NO_FACES

        helper.align_warp_face()
        for cropped_face in helper.cropped_faces:
            check_for_interruption()
            face_rgb = cropped_face[:, :, ::-1].astype(np.float32) / 255.0
            x512 = (
                torch.from_numpy(np.ascontiguousarray(face_rgb))
                .permute(2, 0, 1)
                .unsqueeze(0)
                .to(device)
            )
            out = self._run_gan(descriptor, x512, method, codeformer_fidelity)
            restored_rgb = out.squeeze(0).permute(1, 2, 0).cpu().numpy()
            restored_bgr = (restored_rgb[:, :, ::-1] * 255.0).round().astype(np.uint8)
            helper.add_restored_face(restored_bgr.copy())

        helper.get_inverse_affine()
        pasted_bgr = helper.paste_faces_to_input_image()  # same HxW as input
        pasted_rgb = pasted_bgr[:, :, ::-1].astype(np.float32) / 255.0
        return torch.from_numpy(np.ascontiguousarray(pasted_rgb)).to(device)

    @staticmethod
    def _run_codeformer(descriptor, x512, fidelity):
        """CodeFormer's fidelity weight isn't exposed on descriptor.__call__, so
        drive the underlying model directly, falling back to the plain call.

        The native CodeFormer model uses ``[-1, 1]`` RGB tensors, whereas the
        Spandrel descriptor API (and this manager) uses ``[0, 1]``. Doing the
        conversion here prevents the raw model from shifting color and
        saturation."""
        fidelity = float(max(0.0, min(1.0, fidelity)))
        model = descriptor.model
        native_input = x512.mul(2.0).sub(1.0)
        # spandrel_extra_arches CodeFormer.forward is (x, weight=0.5, **kwargs).
        # It is `weight`, not `w` — extra kwargs are silently swallowed, which
        # pinned fidelity at 0.5 until this was found.
        try:
            result = model(native_input, weight=fidelity)
        except TypeError:
            try:
                result = model(native_input, fidelity)
            except Exception:
                return descriptor(x512)
        if isinstance(result, (tuple, list)):
            result = result[0]
        return result.add(1.0).mul(0.5)

    @staticmethod
    def _run_gfpgan(descriptor, x512):
        """Run GFPGAN using its native ``[-1, 1]`` tensor convention.

        Like CodeFormer, GFPGAN's raw model is trained on normalized tensors,
        but the Spandrel descriptor call does not apply that normalization.
        Convert at this boundary so the restored result retains natural color.
        """
        native_input = x512.mul(2.0).sub(1.0)
        try:
            result = descriptor.model(native_input)
        except Exception:
            return descriptor(x512)
        if isinstance(result, (tuple, list)):
            result = result[0]
        return result.add(1.0).mul(0.5)

    def offload_to_cpu(self):
        for method, descriptor in self._descriptors.items():
            try:
                descriptor.to("cpu")
            except Exception as exc:  # noqa: BLE001
                print(f"[DirtyBirds] Could not offload {method}: {exc}")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def clear_cache(self):
        self._descriptors.clear()
        self._helper = None
        self._helper_failed = False
