"""blender_kit — utilidades para escenas 3D headless (Blender 4.x / 5.x).

Uso dentro de un script de escena:

    import sys; sys.path.insert(0, "<ruta>/motion-fx-core/scripts")
    from blender_kit import *
    args = bk_args()                       # --out --w --h --fps --seconds --samples --preview
    reset(args)
    cam = camera((0, -8, 2), target=(0, 0, 1), lens=35)
    ...
    render_mp4(args)

Ejecutar:  blender -b --factory-startup -P escena.py -- --out out.mp4 --preview
"""
import argparse
import math
import os
import shutil
import subprocess
import sys
import tempfile

import bpy
from mathutils import Vector


def bk_args(**defaults):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=defaults.get("out", "out.mp4"))
    p.add_argument("--w", type=int, default=defaults.get("w", 1920))
    p.add_argument("--h", type=int, default=defaults.get("h", 1080))
    p.add_argument("--fps", type=int, default=defaults.get("fps", 24))
    p.add_argument("--seconds", type=float, default=defaults.get("seconds", 6))
    p.add_argument("--samples", type=int, default=defaults.get("samples", 64))
    p.add_argument("--engine", default=defaults.get("engine", "CYCLES"),
                   help="CYCLES (fiable headless) o EEVEE (rápido, requiere GPU/EGL)")
    p.add_argument("--text", default=defaults.get("text", "TITULO"))
    p.add_argument("--plate", default=None, help="video/imagen de fondo para integrar CG")
    p.add_argument("--blend", default=None, help="guardar también el .blend")
    p.add_argument("--preview", action="store_true")
    a = p.parse_args(argv)
    if a.preview:
        a.w, a.h, a.samples = 960, 540, min(a.samples, 16)
    a.frames = int(round(a.seconds * a.fps))
    return a


def reset(a):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = a.w, a.h
    sc.render.resolution_percentage = 100
    sc.render.fps = a.fps
    sc.frame_start, sc.frame_end = 1, a.frames
    if a.engine.upper().startswith("EEVEE"):
        for name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
            try:
                sc.render.engine = name
                break
            except TypeError:
                continue
    else:
        sc.render.engine = "CYCLES"
        sc.cycles.samples = a.samples
        sc.cycles.use_denoising = True
        sc.cycles.device = "CPU"
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for t in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
                try:
                    prefs.compute_device_type = t
                    prefs.get_devices()
                    if any(d.type == t for d in prefs.devices):
                        for d in prefs.devices:
                            d.use = True
                        sc.cycles.device = "GPU"
                        break
                except TypeError:
                    continue
        except Exception:
            pass
    sc.render.film_transparent = False
    try:
        sc.view_settings.view_transform = "AgX"
    except TypeError:
        sc.view_settings.view_transform = "Filmic"
    sc.view_settings.look = "None"
    world(color=(0.01, 0.01, 0.012))
    return sc


def world(color=(0.02, 0.02, 0.025), strength=1.0, hdri=None):
    w = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get("Background") or nt.nodes.new("ShaderNodeBackground")
    out = nt.nodes.get("World Output") or nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs[1].default_value = strength
    if hdri and os.path.exists(hdri):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdri)
        nt.links.new(env.outputs[0], bg.inputs[0])
    else:
        bg.inputs[0].default_value = (*color, 1)
    return w


def fog(density=0.02, color=(0.8, 0.85, 1.0), anisotropy=0.3):
    """Volumen global en el mundo (god rays con luces spot/sun en Cycles)."""
    w = bpy.context.scene.world
    nt = w.node_tree
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = density
    vol.inputs["Color"].default_value = (*color, 1)
    vol.inputs["Anisotropy"].default_value = anisotropy
    out = nt.nodes.get("World Output")
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return vol


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def camera(loc=(0, -10, 2), target=(0, 0, 0), lens=35, dof=None, sensor=36):
    data = bpy.data.cameras.new("Cam")
    data.lens = lens
    data.sensor_width = sensor
    cam = bpy.data.objects.new("Cam", data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    look_at(cam, target)
    if dof:
        data.dof.use_dof = True
        data.dof.focus_distance = dof[0]
        data.dof.aperture_fstop = dof[1]
    bpy.context.scene.camera = cam
    return cam


def track_to(obj, target_obj):
    c = obj.constraints.new("TRACK_TO")
    c.target = target_obj
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    return c


def empty(loc=(0, 0, 0), name="Target"):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = loc
    return e


def light(kind="AREA", loc=(4, -4, 6), energy=1000, color=(1, 1, 1), size=2,
          target=(0, 0, 0), spot_deg=40):
    data = bpy.data.lights.new(kind.lower(), kind)
    data.energy = energy
    data.color = color
    if kind == "AREA":
        data.size = size
    if kind == "SPOT":
        data.spot_size = math.radians(spot_deg)
        data.spot_blend = 0.3
    if kind == "SUN":
        data.angle = math.radians(size)
    o = bpy.data.objects.new(kind, data)
    bpy.context.collection.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o


def three_point(key=1500, fill=300, rim=1200, target=(0, 0, 1)):
    return (light("AREA", (4, -5, 5), key, (1, .95, .9), 3, target),
            light("AREA", (-5, -3, 2), fill, (.8, .88, 1), 4, target),
            light("AREA", (0, 6, 4), rim, (1, 1, 1), 2, target))


def mat(name, color=(0.8, 0.8, 0.8), metallic=0.0, rough=0.4, emission=None,
        emission_strength=0.0, transmission=0.0, ior=1.45, sss=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    b.inputs["IOR"].default_value = ior
    b.inputs["Alpha"].default_value = alpha
    for key in ("Transmission Weight", "Transmission"):
        if key in b.inputs:
            b.inputs[key].default_value = transmission
            break
    for key in ("Subsurface Weight", "Subsurface"):
        if key in b.inputs:
            b.inputs[key].default_value = sss
            break
    if emission:
        ek = "Emission Color" if "Emission Color" in b.inputs else "Emission"
        b.inputs[ek].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = emission_strength
    return m


def emissive(name, color=(1, .6, .2), strength=10):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs[0].default_value = (*color, 1)
    e.inputs[1].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


def assign(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj


def text3d(body, size=1.0, extrude=0.1, bevel=0.01, loc=(0, 0, 0), font_path=None,
           align="CENTER", rot=(math.radians(90), 0, 0)):
    cu = bpy.data.curves.new("Txt", "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 3
    cu.align_x = align
    cu.align_y = "CENTER"
    if font_path and os.path.exists(font_path):
        cu.font = bpy.data.fonts.load(font_path)
    o = bpy.data.objects.new("Txt", cu)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    return o


def system_font(name="DejaVu Sans:bold"):
    try:
        return subprocess.run(["fc-match", "-f", "%{file}", name],
                              capture_output=True, text=True).stdout.strip()
    except FileNotFoundError:
        return None


def prim(kind="cube", loc=(0, 0, 0), scale=1.0, **kw):
    ops = {"cube": bpy.ops.mesh.primitive_cube_add,
           "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
           "ico": bpy.ops.mesh.primitive_ico_sphere_add,
           "plane": bpy.ops.mesh.primitive_plane_add,
           "cylinder": bpy.ops.mesh.primitive_cylinder_add,
           "torus": bpy.ops.mesh.primitive_torus_add,
           "cone": bpy.ops.mesh.primitive_cone_add,
           "monkey": bpy.ops.mesh.primitive_monkey_add}
    ops[kind](location=loc, **kw)
    o = bpy.context.active_object
    o.scale = (scale,) * 3 if isinstance(scale, (int, float)) else scale
    return o


def smooth(obj, subdiv=2):
    for p in obj.data.polygons:
        p.use_smooth = True
    if subdiv:
        m = obj.modifiers.new("Sub", "SUBSURF")
        m.levels = m.render_levels = subdiv
    return obj


def key(obj, frame, **props):
    """Keyframe: key(obj, 1, location=(0,0,0), rotation_euler=(0,0,1))."""
    for k, v in props.items():
        setattr(obj, k, v)
        obj.keyframe_insert(data_path=k, frame=frame)


def ease_all(obj, interp="BEZIER", easing="EASE_IN_OUT"):
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    curves = getattr(ad.action, "fcurves", None)
    if curves is None:  # Blender 5: acciones por capas/slots
        curves = [fc for layer in ad.action.layers for strip in layer.strips
                  for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = interp
            kp.easing = easing


def motion_blur(on=True, shutter=0.5):
    sc = bpy.context.scene
    sc.render.use_motion_blur = on
    sc.render.motion_blur_shutter = shutter


def plate_background(path):
    """Usa un video/imagen como fondo de cámara para integrar CG (shadow catcher)."""
    sc = bpy.context.scene
    sc.render.film_transparent = True
    p = prim("plane", (0, 0, 0), 30)
    p.is_shadow_catcher = True
    return p


def render_mp4(a, plate=None, crf=18):
    """Renderiza PNGs a un temporal y codifica con ffmpeg. plate: fondo a componer."""
    sc = bpy.context.scene
    tmp = tempfile.mkdtemp(prefix="bk_")
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if sc.render.film_transparent else "RGB"
    sc.render.filepath = os.path.join(tmp, "f_")
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.blend))
    bpy.ops.render.render(animation=True)
    seq = os.path.join(tmp, "f_%04d.png")
    out = os.path.abspath(a.out)
    if plate:
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", plate, "-framerate", str(a.fps),
               "-i", seq, "-filter_complex",
               f"[0:v]scale={a.w}:{a.h}:force_original_aspect_ratio=increase,"
               f"crop={a.w}:{a.h},fps={a.fps}[bg];[bg][1:v]overlay=shortest=1",
               "-c:v", "libx264", "-crf", str(crf), "-pix_fmt", "yuv420p", out]
    else:
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", seq,
               "-c:v", "libx264", "-crf", str(crf), "-pix_fmt", "yuv420p", out]
    subprocess.run(cmd, check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print("OK ->", out)
    return out
