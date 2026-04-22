#!/usr/bin/env python3
"""
UBRViewer – servidor local (dev + LAN).
Sirve archivos estáticos del web-host Y expone endpoints de escritura:
  POST /api/publish        → guarda projects/<id>.json y actualiza manifest.json
  POST /api/rename-project → renombra un proyecto en manifest.json

Uso:
  cd /Users/jose/UBRViewer/web-host
  python3 server.py [puerto]          (puerto por defecto: 8080)
"""

import json
import os
import re
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECTS_DIR = ROOT / "projects"
MANIFEST_PATH = PROJECTS_DIR / "manifest.json"


# ─── helpers ────────────────────────────────────────────────────────────────

def read_manifest():
    try:
        return json.loads(MANIFEST_PATH.read_text("utf-8"))
    except Exception:
        return []


def write_manifest(data):
    MANIFEST_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def sanitize_id(raw: str) -> str:
    clean = re.sub(r"[^\w\-]", "-", str(raw or "")).strip("-")
    return clean or "proyecto"


# ─── handler ────────────────────────────────────────────────────────────────

class UBRHandler(SimpleHTTPRequestHandler):
    """Maneja /api/* con lógica de escritura; todo lo demás va al servidor estático."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ── CORS para desarrollo local ──────────────────────────────────────────
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # ── router ──────────────────────────────────────────────────────────────
    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        if path == "/api/publish":
            self._handle_publish()
        elif path == "/api/rename-project":
            self._handle_rename()
        else:
            self.send_error(404, "Endpoint no encontrado")

    # ── POST /api/publish ───────────────────────────────────────────────────
    def _handle_publish(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))

            project = body.get("project")   # objeto JSON completo del proyecto
            meta    = body.get("meta", {})   # { id, name, description, date, tags }

            if not project or not isinstance(project, dict):
                return self._json_error(400, "Falta 'project' en el body")

            proj_id = sanitize_id(project.get("id") or meta.get("id") or "proyecto")
            proj_name = str(project.get("name") or meta.get("name") or proj_id).strip()

            # 1) Guardar archivo JSON del proyecto
            PROJECTS_DIR.mkdir(exist_ok=True)
            dest = PROJECTS_DIR / f"{proj_id}.json"
            dest.write_text(json.dumps(project, ensure_ascii=False, indent=2), "utf-8")

            # 2) Actualizar manifest.json
            manifest = read_manifest()
            # Quitar entrada previa con el mismo id
            manifest = [e for e in manifest if str(e.get("id", "")) != proj_id]
            clips_count = 0
            for lst in project.get("lists", []):
                clips_count += len(lst.get("clips", []))
            cam_count = len(project.get("cameras", []))
            description = str(meta.get("description") or
                               f"{clips_count} clips · {cam_count} cámara{'s' if cam_count != 1 else ''} YouTube")
            date = str(meta.get("date") or project.get("source", {}).get("date") or "")
            tags = meta.get("tags") if isinstance(meta.get("tags"), list) else []
            new_entry = {
                "id":          proj_id,
                "name":        proj_name,
                "description": description,
                "file":        f"./projects/{proj_id}.json",
                "date":        date,
                "tags":        tags,
            }
            # Insertar al principio (más nuevo primero)
            manifest.insert(0, new_entry)
            write_manifest(manifest)

            self._json_ok({"ok": True, "id": proj_id, "name": proj_name,
                           "clips": clips_count, "cameras": cam_count})

        except Exception as e:
            self._json_error(500, str(e))

    # ── POST /api/rename-project ────────────────────────────────────────────
    def _handle_rename(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            proj_id  = str(body.get("id") or "").strip()
            new_name = str(body.get("name") or "").strip()

            if not proj_id or not new_name:
                return self._json_error(400, "Faltan campos 'id' o 'name'")

            manifest = read_manifest()
            updated = False
            for entry in manifest:
                if str(entry.get("id", "")) == proj_id:
                    entry["name"] = new_name
                    updated = True
                    break

            if not updated:
                return self._json_error(404, f"Proyecto '{proj_id}' no encontrado en manifest")

            # Actualizar también el JSON del proyecto si existe
            proj_file = PROJECTS_DIR / f"{proj_id}.json"
            if proj_file.exists():
                try:
                    proj_data = json.loads(proj_file.read_text("utf-8"))
                    proj_data["name"] = new_name
                    proj_file.write_text(json.dumps(proj_data, ensure_ascii=False, indent=2), "utf-8")
                except Exception:
                    pass

            write_manifest(manifest)
            self._json_ok({"ok": True, "id": proj_id, "name": new_name})

        except Exception as e:
            self._json_error(500, str(e))

    # ── helpers ─────────────────────────────────────────────────────────────
    def _json_ok(self, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _json_error(self, code, msg):
        payload = json.dumps({"ok": False, "error": msg}, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        # Suprimir logs de archivos estáticos; mostrar solo API
        if "/api/" in (args[0] if args else ""):
            print(f"[UBRViewer] {self.address_string()} – {fmt % args}")


# ─── main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(("0.0.0.0", port), UBRHandler)
    print(f"✅  UBRViewer corriendo en http://localhost:{port}")
    print(f"    Acceso LAN:  http://<tu-ip-local>:{port}")
    print(f"    Directorio:  {ROOT}")
    print(f"    API publish: POST /api/publish")
    print(f"    API rename:  POST /api/rename-project")
    print("    (Ctrl+C para detener)\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
