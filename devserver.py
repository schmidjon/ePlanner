"""Local dev server for ePlanner: serves this folder with caching disabled,
so edits show up on a normal reload.  Usage: python3 devserver.py [port]"""
import http.server, sys, functools, os

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
handler = functools.partial(NoCache, directory=os.path.dirname(os.path.abspath(__file__)))
print(f'ePlanner running at http://localhost:{port}')
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
