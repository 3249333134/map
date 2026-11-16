#!/usr/bin/env python3
"""StyleFlow2Cartoon 本地形象生成服务。

算法来自 https://github.com/csnowhermit/styleflow2cartoon：
StyleGAN2(FFHQ) 生成人脸 -> StyleFlow 按 8 个语义属性/光照编辑潜在空间
-> AnimeGANv3(Ghibli) 渲染成二次元形象。

小程序无法直接跑 PyTorch，因此由本脚本提供本地 HTTP 接口：

    python3 server/generate_server.py --port 8765

    GET /health                服务与可调参数
    GET /preset?seed=3         该种子的默认属性值
    GET /generate?seed=3&...   返回 PNG 形象
"""

import argparse
import base64
import io
import json
import os
import pickle
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)
sys.path.insert(0, BASE_DIR)


def load_service_env():
    """Load local service secrets without adding them to source or client bundles."""
    env_file = os.path.join(BASE_DIR, '..', '.env.local')
    if not os.path.isfile(env_file):
        return
    with open(env_file, 'r', encoding='utf-8') as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key in ('AGNES_API_KEY', 'AGNES_BASE_URL') and key not in os.environ:
                os.environ[key] = value

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

import legacy
from module.flow import cnf

WEIGHTS = os.path.join(BASE_DIR, 'weights')
DATA = os.path.join(BASE_DIR, 'data')

# 与 app.py 中的 attribute_names / 取值范围保持一致
ATTRIBUTES = [
    {'key': 'gender', 'label': '性别', 'min': 0.0, 'max': 1.0, 'step': 0.05},
    {'key': 'glasses', 'label': '眼镜', 'min': 0.0, 'max': 1.0, 'step': 0.05},
    {'key': 'yaw', 'label': '侧脸', 'min': -20.0, 'max': 20.0, 'step': 1.0},
    {'key': 'pitch', 'label': '抬头', 'min': -20.0, 'max': 20.0, 'step': 1.0},
    {'key': 'bald', 'label': '脱发', 'min': 0.0, 'max': 1.0, 'step': 0.05},
    {'key': 'beard', 'label': '胡须', 'min': 0.0, 'max': 1.0, 'step': 0.05},
    {'key': 'age', 'label': '年龄', 'min': 0.0, 'max': 65.0, 'step': 1.0},
    {'key': 'expression', 'label': '表情', 'min': 0.0, 'max': 1.0, 'step': 0.05}
]

# 对应 app.py 里的 6 个光照方向滑杆
LIGHTS = [
    {'key': 'light_lr', 'label': '左侧光'},
    {'key': 'light_rl', 'label': '右侧光'},
    {'key': 'light_du', 'label': '底部光'},
    {'key': 'light_ud', 'label': '顶部光'},
    {'key': 'light_off', 'label': '无光'},
    {'key': 'light_front', 'label': '正面光'}
]
PRESET_LIGHT_INDEX = [8, 33, 641, 547, 28, 34]
ATTRIBUTE_DEGREE = [1.5, 2.5, 1.0, 1.0, 2.0, 1.7, 0.93, 1.0]


def clamp(value, low, high):
    return max(low, min(high, value))


class StyleFlowGenerator:
    def __init__(self):
        self.lock = threading.Lock()
        self.cache = {}
        started = time.time()
        self._load()
        self.boot_seconds = round(time.time() - started, 1)

    def _load(self):
        with open(os.path.join(WEIGHTS, 'ffhq.pkl'), 'rb') as handle:
            self.G = legacy.load_network_pkl(handle)['G_ema'].eval()
        self.prior = cnf(512, '512-512-512-512-512', 17, 1)
        self.prior.load_state_dict(torch.load(
            os.path.join(WEIGHTS, 'styleflow_large10k.pt'), map_location='cpu'))
        self.prior.eval()

        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, (os.cpu_count() or 2) - 1)
        self.anime = ort.InferenceSession(
            os.path.join(WEIGHTS, 'animeganv3_ghibli_c1.onnx'),
            sess_options=options,
            providers=['CPUExecutionProvider'])
        self.anime_input = self.anime.get_inputs()[0].name
        self.anime_output = self.anime.get_outputs()[0].name

        with open(os.path.join(DATA, 'sg2latents.pickle'), 'rb') as handle:
            raw = pickle.load(handle)
        self.all_w = np.array(raw['Latent'], dtype=np.float32)
        self.all_attr = np.load(os.path.join(DATA, 'attributes.npy')).astype(np.float32)
        self.all_light = np.load(os.path.join(DATA, 'light.npy')).astype(np.float32)
        self.pre_lighting = [
            torch.from_numpy(self.all_light[index]).float() for index in PRESET_LIGHT_INDEX
        ]
        self.seed_count = len(self.all_w)

    @torch.no_grad()
    def _flow_w_to_z(self, w, attributes, lighting):
        w = torch.Tensor(w)
        att = torch.from_numpy(np.asarray(attributes, dtype=np.float32)).unsqueeze(0).unsqueeze(-1).unsqueeze(-1)
        light = torch.Tensor(lighting)
        features = torch.cat([light, att], dim=1).clone().detach()
        zero_padding = torch.zeros(1, 18, 1)
        return self.prior(w, features, zero_padding)[0].clone().detach()

    @torch.no_grad()
    def _flow_z_to_w(self, z, attributes, lighting):
        att = torch.Tensor(np.asarray(attributes, dtype=np.float32)).unsqueeze(0).unsqueeze(-1).unsqueeze(-1)
        light = torch.Tensor(lighting)
        features = torch.cat([light, att], dim=1).clone().detach()
        zero_padding = torch.zeros(1, 18, 1)
        return self.prior(z, features, zero_padding, True)[0].clone().detach()

    @torch.no_grad()
    def _synthesis(self, w):
        image = self.G.synthesis(torch.Tensor(w), noise_mode='const', force_fp32=True)
        image = (image.permute(0, 2, 3, 1) * 127.5 + 128).clamp(0, 255).to(torch.uint8)
        return image[0].cpu().numpy().copy()

    @torch.no_grad()
    def _cartoon(self, rgb):
        # AnimeGANv3 输入输出都是 NHWC：输入 0..1，输出 -1..1
        face = Image.fromarray(rgb).resize((512, 512), Image.LANCZOS)
        face = np.asarray(face).astype(np.float32) / 255.0
        out = self.anime.run(None, {self.anime_input: face[None]})[0][0]
        out = np.clip((out + 1.0) / 2.0, 0.0, 1.0)
        return (out * 255).astype(np.uint8)

    @torch.no_grad()
    def _resize(self, image, size):
        tensor = torch.from_numpy(image).permute(2, 0, 1).unsqueeze(0).float()
        tensor = torch.nn.functional.interpolate(tensor, size=(size, size), mode='bicubic', align_corners=False)
        return tensor.clamp(0, 255).to(torch.uint8).permute(0, 2, 3, 1).numpy()[0]

    def preset(self, seed):
        index = self._index(seed)
        attributes = [round(float(value), 2) for value in self.all_attr[index].ravel()]
        base = self.all_light[index].ravel()
        return {
            'seed': seed,
            'index': int(index),
            'attributes': dict(zip([item['key'] for item in ATTRIBUTES], attributes)),
            'lights': {item['key']: 0 for item in LIGHTS},
            'baseLight': [round(float(value), 3) for value in base]
        }

    def _index(self, seed):
        return int(abs(seed)) % self.seed_count

    def generate(self, seed, attributes, lights, cartoon=True, size=512):
        index = self._index(seed)
        keys = [item['key'] for item in ATTRIBUTES]
        values = []
        for spec, key in zip(ATTRIBUTES, keys):
            raw = attributes.get(key)
            raw = float(raw) if raw is not None else float(self.all_attr[index].ravel()[keys.index(key)])
            values.append(clamp(raw, spec['min'], spec['max']))

        base_attr = self.all_attr[index].ravel().astype(np.float32)
        target = np.array([
            clamp(base_attr[i] + ATTRIBUTE_DEGREE[i] * (values[i] - base_attr[i]), ATTRIBUTES[i]['min'], ATTRIBUTES[i]['max'])
            for i in range(len(ATTRIBUTES))
        ], dtype=np.float32)

        base_light = self.all_light[index]
        lighting = torch.Tensor(base_light).float()
        for spec, preset in zip(LIGHTS, self.pre_lighting):
            magnitude = clamp(float(lights.get(spec['key'], 0) or 0), 0.0, 1.0)
            if magnitude > 0:
                lighting = lighting + magnitude * (preset - torch.Tensor(base_light).float())

        cache_key = (index, tuple(round(float(v), 2) for v in target),
                     tuple(round(float(lighting.ravel()[i]), 2) for i in range(lighting.numel())),
                     bool(cartoon), int(size))
        if cache_key in self.cache:
            return self.cache[cache_key]

        z = self._flow_w_to_z(self.all_w[index], base_attr, base_light)
        w = self._flow_z_to_w(z, target, lighting)
        photo = self._synthesis(w)
        image = self._cartoon(photo) if cartoon else photo
        if image.shape[0] != size:
            image = self._resize(image, size)

        buffer = io.BytesIO()
        Image.fromarray(image).save(buffer, format='PNG')
        data = buffer.getvalue()
        if len(self.cache) > 48:
            self.cache.clear()
        self.cache[cache_key] = data
        return data


GENERATOR = None
BOOT_LOCK = threading.Lock()


def get_generator():
    global GENERATOR
    with BOOT_LOCK:
        if GENERATOR is None:
            GENERATOR = StyleFlowGenerator()
        return GENERATOR


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, payload):
        self._send(status, json.dumps(payload, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

    def do_POST(self):
        if urlparse(self.path).path != '/generate-anime':
            self._json(404, {'ok': False, 'error': 'unknown path'})
            return
        api_key = os.environ.get('AGNES_API_KEY', '').strip()
        if not api_key:
            self._json(503, {'ok': False, 'error': '尚未配置 AGNES_API_KEY。请检查项目根目录的 .env.local。'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 1 or length > 8 * 1024 * 1024:
                self._json(400, {'ok': False, 'error': '请求内容无效'})
                return
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            franchise = str(payload.get('franchise', '')).strip()[:60]
            character = str(payload.get('character', '')).strip()[:60]
            style = str(payload.get('style', 'fantasy'))
            detail = str(payload.get('prompt', '')).strip()[:180]
            reference = str(payload.get('reference', '')).strip()
            style_guides = {
                'adventure': 'Use a bold, joyful pirate-adventure shonen manga aesthetic, with a recognizable hat/costume silhouette and saturated colors.',
                'mecha': 'Use a dramatic retro-futurist biomechanical mecha anime aesthetic, with a restrained palette, plugsuit-inspired costume shapes and sharp contrast.',
                'fantasy': 'Use a polished open-world fantasy RPG anime aesthetic, with ornate travel clothes, elemental ornaments and luminous colors.'
            }
            if style not in style_guides:
                self._json(400, {'ok': False, 'error': '请选择有效的像素角色风格'})
                return
            prompt = ('Create a polished anime pixel-art chibi game sprite sheet for a mini-program map avatar. '
                      'The canvas must contain exactly a 2 by 2 grid of four equal cells, with one full-body character centered in each cell. '
                      'All four cells show the SAME character, outfit, palette, proportions and scale, with clean clear gutters and no labels. '
                      'Frames in reading order: idle standing, walk step A, walk step B, cheerful wave. Large expressive anime eyes, oversized head, tiny body, '
                      'crisp chunky pixel clusters, limited palette, transparent or pure white background, no scenery, no text, no watermark. '
                      'Keep the character entirely inside each cell so each quadrant can be cropped independently. ' + style_guides[style])
            if franchise or character:
                prompt += ' Character reference: ' + ' / '.join(value for value in (franchise, character) if value) + '. Match the recognizable costume, hair and color cues.'
            if detail:
                prompt += ' Extra details: ' + detail + '.'
            if reference:
                if not reference.startswith('data:image/') or len(reference) > 7 * 1024 * 1024:
                    self._json(400, {'ok': False, 'error': '参考图片格式或大小不正确'})
                    return
                prompt += ' Use the supplied reference image as the character identity and costume guide.'
            request_body = json.dumps({
                'model': 'agnes-image-2.5-flash',
                'prompt': prompt,
                'size': '1K',
                'n': 1,
                'return_base64': True,
                'extra_body': {'ratio': '1:1', 'response_format': 'b64_json'}
            }).encode('utf-8')
            if reference:
                request_body = json.dumps({
                    'model': 'agnes-image-2.5-flash', 'prompt': prompt, 'size': '1K', 'n': 1,
                    'return_base64': True,
                    'extra_body': {'ratio': '1:1', 'image': [reference], 'response_format': 'b64_json'}
                }).encode('utf-8')
            base_url = os.environ.get('AGNES_BASE_URL', 'https://apihub.agnes-ai.com/v1').rstrip('/')
            request = urllib.request.Request(
                base_url + '/images/generations', data=request_body,
                headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(request, timeout=180) as response:
                result = json.loads(response.read().decode('utf-8'))
            image = result.get('data', [{}])[0]
            if image.get('b64_json'):
                data = base64.b64decode(image['b64_json'])
            elif image.get('url'):
                with urllib.request.urlopen(image['url'], timeout=60) as response:
                    data = response.read()
            else:
                raise RuntimeError('图像服务没有返回图片，请稍后重试')
            sheet = Image.open(io.BytesIO(data)).convert('RGB')
            width, height = sheet.size
            frames = []
            for row in range(2):
                for col in range(2):
                    frame = sheet.crop((col * width // 2, row * height // 2, (col + 1) * width // 2, (row + 1) * height // 2)).convert('RGBA')
                    pixels = frame.load()
                    for y in range(frame.height):
                        for x in range(frame.width):
                            red, green, blue, _ = pixels[x, y]
                            if red > 242 and green > 242 and blue > 242:
                                pixels[x, y] = (red, green, blue, 0)
                    bounds = frame.getbbox()
                    if bounds:
                        frame = frame.crop(bounds)
                    frame.thumbnail((72, 88), Image.Resampling.NEAREST)
                    canvas = Image.new('RGBA', (88, 104), (0, 0, 0, 0))
                    canvas.alpha_composite(frame, ((88 - frame.width) // 2, 104 - frame.height))
                    output = io.BytesIO()
                    canvas.save(output, format='PNG', optimize=True)
                    frames.append(base64.b64encode(output.getvalue()).decode('ascii'))
            self._json(200, {'ok': True, 'frames': frames})
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', errors='replace')
            sys.stderr.write('image API error %s: %s\n' % (error.code, body[:1000]))
            message = '图像服务请求失败，请检查 API 配置和额度'
            try:
                message = json.loads(body).get('error', {}).get('message') or message
            except (ValueError, AttributeError):
                pass
            self._json(502, {'ok': False, 'error': message[:240]})
        except Exception as error:  # noqa: BLE001
            self._json(500, {'ok': False, 'error': str(error)[:240]})

    def do_GET(self):
        parsed = urlparse(self.path)
        query = {key: value[-1] for key, value in parse_qs(parsed.query).items()}
        try:
            if parsed.path == '/health':
                generator = get_generator()
                self._json(200, {
                    'ok': True,
                    'ready': True,
                    'seeds': generator.seed_count,
                    'attributes': ATTRIBUTES,
                    'lights': LIGHTS,
                    'bootSeconds': generator.boot_seconds
                })
                return
            if parsed.path == '/preset':
                seed = int(query.get('seed', '0'))
                self._json(200, get_generator().preset(seed))
                return
            if parsed.path == '/generate':
                seed = int(query.get('seed', '0'))
                attributes = {item['key']: query[item['key']] for item in ATTRIBUTES if item['key'] in query}
                lights = {item['key']: query[item['key']] for item in LIGHTS if item['key'] in query}
                cartoon = query.get('cartoon', '1') not in ('0', 'false')
                size = int(query.get('size', '512'))
                started = time.time()
                data = get_generator().generate(seed, attributes, lights, cartoon, size)
                sys.stderr.write('generate seed=%s %.1fs %dKB\n' % (seed, time.time() - started, len(data) // 1024))
                self._send(200, data, 'image/png')
                return
            self._json(404, {'ok': False, 'error': 'unknown path'})
        except Exception as error:  # noqa: BLE001
            self._json(500, {'ok': False, 'error': str(error)})


def main():
    load_service_env()
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    torch.set_grad_enabled(False)
    if os.environ.get('AGNES_API_KEY', '').strip():
        print('使用 Agnes AI 云端动漫图像生成 API。')
    else:
        print('加载本地人像模型中（首次大约需要 10-30 秒）...')
        get_generator()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print('形象生成服务已启动: http://%s:%d' % (args.host, args.port))
    server.serve_forever()


if __name__ == '__main__':
    main()
